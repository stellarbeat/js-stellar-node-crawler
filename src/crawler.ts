import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import * as P from 'pino';
import { CrawlProcessState, CrawlState } from './crawl-state';
import { CrawlResult } from './crawl-result';
import { CrawlerConfiguration } from './crawler-configuration';
import { CrawlStateValidator } from './crawl-state-validator';
import { CrawlLogger } from './crawl-logger';
import {
	ClosePayload,
	ConnectedPayload,
	ConnectionManager,
	DataPayload
} from './connection-manager';
import { err } from 'neverthrow';
import { StellarMessageHandler } from './peer-listener/stellar-message-handlers/stellar-message-handler';
import { CrawlQueueManager } from './crawl-queue-manager';
import { NodeAddress, nodeAddressToPeerKey } from './node-address';
import { CrawlTask } from './crawl-task';
import { PeerListener } from './peer-listener/peer-listener';

type QuorumSetHash = string;

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
		private stellarMessageHandler: StellarMessageHandler, //event bus would be cleaner...
		private readonly connectionManager: ConnectionManager,
		private crawlQueueManager: CrawlQueueManager,
		private peerListener: PeerListener,

		private readonly logger: P.Logger
	) {
		this.logger = logger.child({ mod: 'Crawler' });
		this.setupEventHandlers();
	}

	private setupEventHandlers() {
		this.setupConnectionManagerEvents();
	}

	private setupConnectionManagerEvents() {
		this.connectionManager.on('connected', (data: ConnectedPayload) => {
			this.peerListener.onConnected(
				data,
				this.crawlState.peerNodes,
				this.crawlState.topTierNodes.has(data.publicKey),
				new Date()
			);
		});
		this.connectionManager.on('data', (data: DataPayload) => {
			const result = this.peerListener.onData(data, this.crawlState);
			if (result.isOk() && result.value.peers.length > 0) {
				this.onPeerAddressesReceived(result.value.peers);
			}
		});
		this.connectionManager.on('close', (data: ClosePayload) => {
			this.crawlQueueManager.completeCrawlQueueTask(
				this.crawlState.crawlQueueTaskDoneCallbacks,
				data.address
			);

			if (!data.publicKey) {
				this.crawlState.failedConnections.push(data.address);
			} else {
				this.peerListener.onConnectionClose(
					data.address,
					data.publicKey,
					this.crawlState,
					new Date()
				);
			}
		});
	}

	private onPeerAddressesReceived(peerAddresses: NodeAddress[]) {
		if (this.crawlState.state === CrawlProcessState.TOP_TIER_SYNC) {
			this.crawlState.peerAddressesReceivedDuringSync.concat(peerAddresses);
		} else {
			peerAddresses.forEach((peerAddress) => this.crawlPeerNode(peerAddress));
		}
	}

	private get crawlState(): CrawlState {
		if (!this._crawlState) throw new Error('crawlState not set');
		return this._crawlState;
	}

	private initializeCrawlState(
		topTierQuorumSet: QuorumSet,
		topTierAddresses: NodeAddress[],
		latestClosedLedger: Ledger,
		quorumSets: Map<QuorumSetHash, QuorumSet> = new Map<
			QuorumSetHash,
			QuorumSet
		>()
	) {
		if (this._crawlState && this.crawlState.state !== CrawlProcessState.IDLE) {
			return err(new Error('Crawl process already running'));
		}

		this._crawlState = new CrawlState(
			topTierQuorumSet,
			quorumSets,
			latestClosedLedger,
			this.config.nodeConfig.network,
			this.logger
		);

		this._crawlState.topTierAddresses = new Set(
			topTierAddresses.map((address) => `${address[0]}:${address[1]}`)
		);

		return CrawlStateValidator.validateCrawlState(this.crawlState, this.config);
	}

	/*
	 * @param topTierQuorumSet QuorumSet of top tier nodes that the crawler should trust to close ledgers and determine the correct externalized value.
	 * Top tier nodes are trusted by everyone transitively, otherwise there would be no quorum intersection. Stellar core forwards scp messages of every transitively trusted node. Thus, we can close ledgers when connecting to any node.
	 */
	async crawl(
		nodeAddresses: NodeAddress[],
		topTierQuorumSet: QuorumSet,
		topTierNodeAddresses: NodeAddress[],
		latestClosedLedger: Ledger = {
			sequence: BigInt(0),
			closeTime: new Date(0),
			localCloseTime: new Date(0),
			value: '' //todo: cleaner solution
		},
		quorumSets: Map<QuorumSetHash, QuorumSet> = new Map<
			QuorumSetHash,
			QuorumSet
		>()
	): Promise<CrawlResult> {
		return new Promise<CrawlResult>((resolve, reject) => {
			this.initializeAndStartCrawl(
				topTierQuorumSet,
				latestClosedLedger,
				quorumSets,
				resolve,
				reject,
				nodeAddresses,
				topTierNodeAddresses
			);
		});
	}

	private initializeAndStartCrawl(
		topTierQuorumSet: QuorumSet,
		latestClosedLedger: Ledger,
		quorumSets: Map<QuorumSetHash, QuorumSet>,
		resolve: (value: PromiseLike<CrawlResult> | CrawlResult) => void,
		reject: (reason?: any) => void,
		nodeAddresses: NodeAddress[],
		topTierNodeAddresses: NodeAddress[]
	) {
		this.initializeCrawlState(
			topTierQuorumSet,
			topTierNodeAddresses,
			latestClosedLedger,
			quorumSets
		)
			.mapErr((error) => reject(error))
			.map(() =>
				this.syncTopTierAndCrawl(
					resolve,
					reject,
					this.initializeCrawlLogger(nodeAddresses),
					topTierNodeAddresses,
					nodeAddresses
				)
			);
	}

	private syncTopTierAndCrawl(
		resolve: (value: PromiseLike<CrawlResult> | CrawlResult) => void,
		reject: (reason?: any) => void,
		crawlLogger: CrawlLogger,
		topTierAddresses: NodeAddress[] = [],
		nodeAddresses: NodeAddress[]
	) {
		this.startTopTierSync(topTierAddresses);

		setTimeout(() => {
			this.startCrawlProcess(resolve, reject, crawlLogger, nodeAddresses);
		}, 10000); //todo: after all top tier nodes have connected, not just timer
	}

	private startCrawlProcess(
		resolve: (value: PromiseLike<CrawlResult> | CrawlResult) => void,
		reject: (reason?: any) => void,
		crawlLogger: CrawlLogger,
		nodeAddresses: NodeAddress[]
	) {
		this.logger.info(
			{
				topTierConnectionCount:
					this.connectionManager.getNumberOfActiveConnections()
			},
			'Starting crawl process'
		);
		this.crawlState.state = CrawlProcessState.CRAWLING;
		this.peerListener.startConsensusTracking();
		this.setupCrawlCompletionHandlers(resolve, reject, crawlLogger);
		if (
			nodeAddresses.concat(this.crawlState.peerAddressesReceivedDuringSync)
				.length === 0 &&
			this.connectionManager.getNumberOfActiveConnections() === 0
		) {
			this.crawlState.state = CrawlProcessState.IDLE;
			this.logger.warn(
				'No nodes to crawl and top tier connections closed, crawl failed'
			);
			reject(new Error('No nodes to crawl and top tier connections failed'));
			return;
		}

		nodeAddresses
			.concat(this.crawlState.peerAddressesReceivedDuringSync)
			.forEach((address) => this.crawlPeerNode(address));
	}

	private startTopTierSync(topTierAddresses: NodeAddress[]) {
		this.logger.info('Starting Top Tier sync');
		this.crawlState.state = CrawlProcessState.TOP_TIER_SYNC;

		topTierAddresses.forEach((address) =>
			this.connectionManager.connectToNode(address[0], address[1])
		);
	}

	private setupCrawlCompletionHandlers(
		resolve: (value: PromiseLike<CrawlResult> | CrawlResult) => void,
		reject: (reason?: any) => void,
		crawlLogger: CrawlLogger
	) {
		const maxCrawlTimeout = this.startMaxCrawlTimeout(
			resolve,
			reject,
			crawlLogger,
			this.crawlState
		);
		this.crawlQueueManager.onDrain(() => {
			clearTimeout(maxCrawlTimeout);
			if (
				this.crawlState.state === CrawlProcessState.CRAWLING &&
				this.crawlQueueManager.queueLength() === 0 &&
				this.connectionManager
					.getActiveConnectionAddresses()
					.every((address) => this.crawlState.topTierAddresses.has(address))
			) {
				this.logger.info('Stopping crawl process');
				this.peerListener.stop().then(() => {
					this.finish(resolve, reject, crawlLogger);
					this.crawlState.state = CrawlProcessState.STOPPING;
				});
			}
		});
	}

	private initializeCrawlLogger(nodeAddresses: NodeAddress[]) {
		const crawlLogger = new CrawlLogger(
			this.crawlState,
			this.connectionManager,
			this.crawlQueueManager,
			this.logger
		);
		crawlLogger.start(nodeAddresses.length);
		return crawlLogger;
	}

	private startMaxCrawlTimeout(
		resolve: (value: CrawlResult | PromiseLike<CrawlResult>) => void,
		reject: (error: Error) => void,
		crawlLogger: CrawlLogger,
		crawlState: CrawlState
	) {
		return setTimeout(() => {
			this.logger.fatal('Max crawl time hit, closing all connections');
			this.peerListener
				.stop()
				.then(() => this.finish(resolve, reject, crawlLogger));
			crawlState.maxCrawlTimeHit = true;
		}, this.config.maxCrawlTime);
	}

	private finish(
		resolve: (value: CrawlResult | PromiseLike<CrawlResult>) => void,
		reject: (error: Error) => void,
		crawlLogger: CrawlLogger
	): void {
		crawlLogger.stop();
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
				this.connectionManager.connectToNode(nodeAddress[0], nodeAddress[1])
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
}
