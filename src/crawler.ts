import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import * as P from 'pino';
import { QuorumSetManager } from './quorum-set-manager';
import { CrawlProcessState, CrawlState } from './crawl-state';
import { CrawlResult } from './crawl-result';
import { CrawlerConfiguration } from './crawler-configuration';
import { CrawlStateValidator } from './crawl-state-validator';
import { CrawlLogger } from './crawl-logger';
import { DisconnectTimeout } from './disconnect-timeout';
import {
	ClosePayload,
	ConnectedPayload,
	ConnectionManager,
	DataPayload
} from './connection-manager';
import { err } from 'neverthrow';
import {
	PeerAddressesReceivedEvent,
	StellarMessageHandler
} from './stellar-message-handlers/stellar-message-handler';
import { CrawlQueueManager } from './crawl-queue-manager';
import { NodeAddress } from './node-address';
import { CrawlTask } from './crawl-task';
import { OnConnectedHandler } from './crawl-connection-event-handlers/on-connected-handler';
import { OnDataHandler } from './crawl-connection-event-handlers/on-data-handler';
import { OnConnectionCloseHandler } from './crawl-connection-event-handlers/on-connection-close-handler';

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
	private disconnectTimeout: DisconnectTimeout;
	private _crawlState: CrawlState | null = null;

	constructor(
		private config: CrawlerConfiguration,
		private quorumSetManager: QuorumSetManager,
		private stellarMessageHandler: StellarMessageHandler,
		private readonly connectionManager: ConnectionManager,
		private crawlQueueManager: CrawlQueueManager,
		private onConnectedHandler: OnConnectedHandler,
		private onDataHandler: OnDataHandler,
		private onConnectionCloseHandler: OnConnectionCloseHandler,

		private readonly logger: P.Logger
	) {
		this.logger = logger.child({ mod: 'Crawler' });
		this.disconnectTimeout = new DisconnectTimeout(logger);
		this.setupEventHandlers();
	}

	private setupEventHandlers() {
		this.setupStellarMessageHandlerEvents();
		this.setupConnectionManagerEvents();
	}

	private setupConnectionManagerEvents() {
		this.connectionManager.on('connected', (data: ConnectedPayload) => {
			this.onConnectedHandler.onConnected(
				data,
				this.crawlState.peerNodes,
				this.crawlState.topTierNodes,
				this.crawlState.listenTimeouts,
				new Date()
			);
		});
		this.connectionManager.on('data', (data: DataPayload) => {
			this.onDataHandler.onData(data, this.crawlState);
		});
		this.connectionManager.on('close', (data: ClosePayload) => {
			this.onConnectionCloseHandler.onConnectionClose(
				data.address,
				data.publicKey,
				this.crawlState,
				new Date()
			);
		});
	}

	private setupStellarMessageHandlerEvents() {
		this.stellarMessageHandler.on(
			'peerAddressesReceived',
			(peerAddresses: PeerAddressesReceivedEvent) =>
				this.onPeerAddressesReceived(peerAddresses.peerAddresses)
		);
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
		latestClosedLedger: Ledger = {
			sequence: BigInt(0),
			closeTime: new Date(0),
			value: '', //todo: store and return value
			localCloseTime: new Date(0)
		},
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
		this.initializeCrawlState(topTierQuorumSet, latestClosedLedger, quorumSets)
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
		}, 5000); //todo: after all top tier nodes have connected, not just timer
	}

	private startCrawlProcess(
		resolve: (value: PromiseLike<CrawlResult> | CrawlResult) => void,
		reject: (reason?: any) => void,
		crawlLogger: CrawlLogger,
		nodeAddresses: NodeAddress[]
	) {
		this.logger.info('Starting crawl process');
		this.crawlState.state = CrawlProcessState.CRAWLING;
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
		topTierAddresses.forEach((address) => this.crawlPeerNode(address, true));
	}

	private setupCrawlCompletionHandlers(
		resolve: (value: PromiseLike<CrawlResult> | CrawlResult) => void,
		reject: (reason?: any) => void,
		crawlLogger: CrawlLogger
	) {
		const maxCrawlTimeout = this.startMaxCrawlTimeout(this.crawlState);
		this.crawlQueueManager.onDrain(() => {
			clearTimeout(maxCrawlTimeout);
			this.completeCrawlProcess(resolve, reject, crawlLogger);
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

	private startMaxCrawlTimeout(crawlState: CrawlState) {
		return setTimeout(() => {
			this.logger.fatal('Max crawl time hit, closing all connections');
			this.connectionManager.shutdown();
			crawlState.maxCrawlTimeHit = true;
		}, this.config.maxCrawlTime);
	}

	private completeCrawlProcess(
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
			latestClosedLedger: this.crawlState.latestClosedLedger
		};
	}

	private crawlPeerNode(nodeAddress: NodeAddress, isTopTier = false): void {
		const crawlTask: CrawlTask = {
			nodeAddress: nodeAddress,
			crawlState: this.crawlState,
			topTier: isTopTier,
			connectCallback: () =>
				this.connectionManager.connectToNode(nodeAddress[0], nodeAddress[1])
		};

		this.crawlQueueManager.addCrawlTask(crawlTask);
	}
}
