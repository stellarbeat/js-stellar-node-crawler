import * as P from 'pino';
import { CrawlProcessState, CrawlState } from './crawl-state';
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
	private _crawlState: CrawlState | null = null;

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

	async crawl(
		nodeAddresses: NodeAddress[],
		topTierNodeAddresses: NodeAddress[],
		crawlState: CrawlState
	): Promise<CrawlResult> {
		return new Promise<CrawlResult>((resolve, reject) => {
			if (
				this._crawlState &&
				this.crawlState.state !== CrawlProcessState.IDLE
			) {
				return reject(new Error('Crawl process already running'));
			}
			this._crawlState = crawlState;
			this._crawlState.topTierAddresses = new Set(
				topTierNodeAddresses.map((address) => `${address[0]}:${address[1]}`)
			);
			this.syncTopTierAndCrawl(
				resolve,
				reject,
				topTierNodeAddresses,
				nodeAddresses
			);
		});
	}

	private setupPeerListenerEvents() {
		this.networkObserver.on('peers', (peers: NodeAddress[]) => {
			this.onPeerAddressesReceived(peers);
		});
		this.networkObserver.on('disconnect', (data: ClosePayload) => {
			this.crawlQueueManager.completeCrawlQueueTask(
				this.crawlState.crawlQueueTaskDoneCallbacks,
				data.address
			);

			if (!data.publicKey) {
				this.crawlState.failedConnections.push(data.address);
			}
		});
	}

	private onPeerAddressesReceived(peerAddresses: NodeAddress[]) {
		if (this.crawlState.state === CrawlProcessState.TOP_TIER_SYNC) {
			this.crawlState.peerAddressesReceivedDuringSync =
				this.crawlState.peerAddressesReceivedDuringSync.concat(peerAddresses);
		} else {
			peerAddresses.forEach((peerAddress) => this.crawlPeerNode(peerAddress));
		}
	}

	private async syncTopTierAndCrawl(
		resolve: (value: PromiseLike<CrawlResult> | CrawlResult) => void,
		reject: (reason?: any) => void,
		topTierAddresses: NodeAddress[],
		nodeAddresses: NodeAddress[]
	) {
		const nrOfActiveTopTierConnections = await this.startTopTierSync(
			topTierAddresses
		);
		this.startCrawlProcess(
			resolve,
			reject,
			nodeAddresses,
			nrOfActiveTopTierConnections
		);
	}

	private startCrawlProcess(
		resolve: (value: PromiseLike<CrawlResult> | CrawlResult) => void,
		reject: (reason?: any) => void,
		nodeAddresses: NodeAddress[],
		nrOfActiveTopTierConnections: number
	) {
		const nodesToCrawl = nodeAddresses.concat(
			this.crawlState.peerAddressesReceivedDuringSync
		);

		if (nodesToCrawl.length === 0 && nrOfActiveTopTierConnections === 0) {
			this.logger.warn(
				'No nodes to crawl and top tier connections closed, crawl failed'
			);
			reject(new Error('No nodes to crawl and top tier connections failed'));
			return;
		}

		this.logger.info('Starting crawl process');
		this.crawlLogger.start(this.crawlState, nodeAddresses.length);
		this.crawlState.state = CrawlProcessState.CRAWLING;
		this.setupCrawlCompletionHandlers(resolve, reject);

		if (nodesToCrawl.length === 0) {
			this.logger.warn('No nodes to crawl');
			this.networkObserver.stop().then(() => {
				this.finish(resolve, reject);
				this.crawlState.state = CrawlProcessState.STOPPING;
			});
		} else nodesToCrawl.forEach((address) => this.crawlPeerNode(address));
	}

	private async startTopTierSync(topTierAddresses: NodeAddress[]) {
		this.logger.info('Starting Top Tier sync');
		this.crawlState.state = CrawlProcessState.TOP_TIER_SYNC;
		return this.networkObserver.observe(topTierAddresses, this.crawlState);
	}

	private setupCrawlCompletionHandlers(
		resolve: (value: PromiseLike<CrawlResult> | CrawlResult) => void,
		reject: (reason?: any) => void
	) {
		this.startMaxCrawlTimeout(resolve, reject, this.crawlState);
		this.crawlQueueManager.onDrain(() => {
			this.logger.info('Stopping crawl process');
			this.crawlState.state = CrawlProcessState.STOPPING;
			this.networkObserver.stop().then(() => {
				this.finish(resolve, reject);
			});
		});
	}

	private startMaxCrawlTimeout(
		resolve: (value: CrawlResult | PromiseLike<CrawlResult>) => void,
		reject: (error: Error) => void,
		crawlState: CrawlState
	) {
		this.maxCrawlTimeManager.setTimer(this.config.maxCrawlTime, () => {
			this.logger.fatal('Max crawl time hit, closing all connections');
			this.networkObserver.stop().then(() => this.finish(resolve, reject));
			crawlState.maxCrawlTimeHit = true;
		});
	}

	private finish(
		resolve: (value: CrawlResult | PromiseLike<CrawlResult>) => void,
		reject: (error: Error) => void
	): void {
		this.crawlLogger.stop();
		this.maxCrawlTimeManager.clearTimer();
		this.crawlState.state = CrawlProcessState.IDLE;

		if (this.hasCrawlTimedOut()) {
			//todo clean crawl-queue and connections
			reject(new Error('Max crawl time hit, shutting down crawler'));
			return;
		}

		resolve(this.constructCrawlResult());
	}

	private hasCrawlTimedOut(): boolean {
		return this.crawlState.maxCrawlTimeHit;
	}

	private constructCrawlResult(): CrawlResult {
		return {
			peers: this.crawlState.peerNodes.getAll(),
			closedLedgers: this.crawlState.slots.getConfirmedClosedSlotIndexes(),
			latestClosedLedger: this.crawlState.latestConfirmedClosedLedger
		};
	}

	private crawlPeerNode(nodeAddress: NodeAddress): void {
		const peerKey = nodeAddressToPeerKey(nodeAddress);

		if (!this.canNodeBeCrawled(peerKey)) return;

		this.logNodeAddition(peerKey);
		this.crawlState.crawledNodeAddresses.add(peerKey);
		const crawlTask: CrawlTask = {
			nodeAddress: nodeAddress,
			crawlState: this.crawlState,
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
			!this.crawlState.crawledNodeAddresses.has(peerKey) &&
			!this.crawlState.topTierAddresses.has(peerKey)
		);
	}

	private get crawlState(): CrawlState {
		if (!this._crawlState) throw new Error('crawlState not set');
		return this._crawlState;
	}
}
