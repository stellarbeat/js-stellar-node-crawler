import * as P from 'pino';
import { CrawlProcessState, Crawl } from './crawl';
import { CrawlResult } from './crawl-result';
import { CrawlerConfiguration } from './crawler-configuration';
import { CrawlLogger } from './crawl-logger';
import { CrawlQueueManager } from './crawl-queue-manager';
import { NodeAddress, nodeAddressToPeerKey } from './node-address';
import { CrawlTask } from './crawl-task';
import { MaxCrawlTimeManager } from './max-crawl-time-manager';
import { ClosePayload } from './network-observer/connection-manager';
import { NetworkObserver } from './network-observer/network-observer';

export interface Ledger {
	sequence: bigint;
	closeTime: Date;
	localCloseTime: Date;
	value: string;
}

/**
 * The crawler is the orchestrator of the crawling process.
 * It connects to nodes, delegates the handling of incoming messages to the StellarMessageHandler,
 * and manages the crawl state.
 */
export class Crawler {
	private _crawl: Crawl | null = null;

	constructor(
		private config: CrawlerConfiguration,
		private crawlQueueManager: CrawlQueueManager,
		private maxCrawlTimeManager: MaxCrawlTimeManager,
		private networkObserver: NetworkObserver,
		private crawlLogger: CrawlLogger,
		public readonly logger: P.Logger
	) {
		this.logger = logger.child({ mod: 'Crawler' });
		this.setupPeerListenerEvents();
	}

	async startCrawl(crawl: Crawl): Promise<CrawlResult> {
		return new Promise<CrawlResult>((resolve, reject) => {
			if (this.isCrawlRunning()) {
				return reject(new Error('Crawl process already running'));
			}
			this.crawl = crawl;

			this.syncTopTierAndCrawl(resolve, reject);
		});
	}

	private isCrawlRunning() {
		return this._crawl && this.crawl.state !== CrawlProcessState.IDLE;
	}

	private setupPeerListenerEvents() {
		this.networkObserver.on('peers', (peers: NodeAddress[]) => {
			this.onPeerAddressesReceived(peers);
		});
		this.networkObserver.on('disconnect', (data: ClosePayload) => {
			this.crawlQueueManager.completeCrawlQueueTask(
				this.crawl.crawlQueueTaskDoneCallbacks,
				data.address
			);

			if (!data.publicKey) {
				this.crawl.failedConnections.push(data.address);
			}
		});
	}

	private onPeerAddressesReceived(peerAddresses: NodeAddress[]) {
		if (this.crawl.state === CrawlProcessState.TOP_TIER_SYNC) {
			this.crawl.peerAddressesReceivedDuringSync =
				this.crawl.peerAddressesReceivedDuringSync.concat(peerAddresses);
		} else {
			peerAddresses.forEach((peerAddress) => this.crawlPeerNode(peerAddress));
		}
	}

	private async syncTopTierAndCrawl(
		resolve: (value: PromiseLike<CrawlResult> | CrawlResult) => void,
		reject: (reason?: any) => void
	) {
		const nrOfActiveTopTierConnections = await this.startTopTierSync();
		this.startCrawlProcess(resolve, reject, nrOfActiveTopTierConnections);
	}

	private startCrawlProcess(
		resolve: (value: PromiseLike<CrawlResult> | CrawlResult) => void,
		reject: (reason?: any) => void,
		nrOfActiveTopTierConnections: number
	) {
		const nodesToCrawl = this.crawl.nodesToCrawl.concat(
			this.crawl.peerAddressesReceivedDuringSync
		);

		if (
			this.crawl.nodesToCrawl.length === 0 &&
			nrOfActiveTopTierConnections === 0
		) {
			this.logger.warn(
				'No nodes to crawl and top tier connections closed, crawl failed'
			);
			reject(new Error('No nodes to crawl and top tier connections failed'));
			return;
		}

		this.logger.info('Starting crawl process');
		this.crawlLogger.start(this.crawl);
		this.crawl.state = CrawlProcessState.CRAWLING;
		this.setupCrawlCompletionHandlers(resolve, reject);

		if (nodesToCrawl.length === 0) {
			this.logger.warn('No nodes to crawl');
			this.networkObserver.stop().then(() => {
				this.finish(resolve, reject);
				this.crawl.state = CrawlProcessState.STOPPING;
			});
		} else nodesToCrawl.forEach((address) => this.crawlPeerNode(address));
	}

	private async startTopTierSync() {
		this.logger.info('Starting Top Tier sync');
		this.crawl.state = CrawlProcessState.TOP_TIER_SYNC;
		return this.networkObserver.startObservation(this.crawl.observation);
	}

	private setupCrawlCompletionHandlers(
		resolve: (value: PromiseLike<CrawlResult> | CrawlResult) => void,
		reject: (reason?: any) => void
	) {
		this.startMaxCrawlTimeout(resolve, reject);
		this.crawlQueueManager.onDrain(() => {
			this.logger.info('Stopping crawl process');
			this.crawl.state = CrawlProcessState.STOPPING;
			this.networkObserver.stop().then(() => {
				this.finish(resolve, reject);
			});
		});
	}

	private startMaxCrawlTimeout(
		resolve: (value: CrawlResult | PromiseLike<CrawlResult>) => void,
		reject: (error: Error) => void
	) {
		this.maxCrawlTimeManager.setTimer(this.config.maxCrawlTime, () => {
			this.logger.fatal('Max crawl time hit, closing all connections');
			this.networkObserver.stop().then(() => this.finish(resolve, reject));
			this.crawl.maxCrawlTimeHit = true;
		});
	}

	private finish(
		resolve: (value: CrawlResult | PromiseLike<CrawlResult>) => void,
		reject: (error: Error) => void
	): void {
		this.crawlLogger.stop();
		this.maxCrawlTimeManager.clearTimer();
		this.crawl.state = CrawlProcessState.IDLE;

		if (this.hasCrawlTimedOut()) {
			//todo clean crawl-queue and connections
			reject(new Error('Max crawl time hit, shutting down crawler'));
			return;
		}

		resolve(this.constructCrawlResult());
	}

	private hasCrawlTimedOut(): boolean {
		return this.crawl.maxCrawlTimeHit;
	}

	private constructCrawlResult(): CrawlResult {
		return {
			peers: this.crawl.observation.peerNodes.getAll(),
			closedLedgers:
				this.crawl.observation.slots.getConfirmedClosedSlotIndexes(),
			latestClosedLedger: this.crawl.observation.latestConfirmedClosedLedger
		};
	}

	private crawlPeerNode(nodeAddress: NodeAddress): void {
		const peerKey = nodeAddressToPeerKey(nodeAddress);

		if (!this.canNodeBeCrawled(peerKey)) return;

		this.logNodeAddition(peerKey);
		this.crawl.crawledNodeAddresses.add(peerKey);
		const crawlTask: CrawlTask = {
			nodeAddress: nodeAddress,
			crawl: this.crawl,
			connectCallback: () =>
				this.networkObserver.connectToNode(nodeAddress[0], nodeAddress[1])
		};

		this.crawlQueueManager.addCrawlTask(crawlTask);
	}

	private logNodeAddition(peerKey: string): void {
		this.logger.debug({ peer: peerKey }, 'Adding address to crawl queue');
	}

	private canNodeBeCrawled(peerKey: string): boolean {
		return (
			!this.crawl.crawledNodeAddresses.has(peerKey) &&
			!this.crawl.observation.topTierAddressesSet.has(peerKey)
		);
	}

	private get crawl(): Crawl {
		if (!this._crawl) throw new Error('crawl not set');
		return this._crawl;
	}

	private set crawl(crawl: Crawl) {
		this._crawl = crawl;
	}
}
