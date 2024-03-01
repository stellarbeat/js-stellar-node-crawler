import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { NodeInfo } from '@stellarbeat/js-stellar-node-connector/lib/node';
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
import { PeerNode } from './peer-node';
import { err } from 'neverthrow';
import {
	PeerAddressesReceivedEvent,
	StellarMessageHandler
} from './stellar-message-handlers/stellar-message-handler';
import { ScpEnvelopeHandler } from './stellar-message-handlers/scp-envelope/scp-envelope-handler';
import { CrawlQueueManager } from './crawl-queue-manager';
import { NodeAddress } from './node-address';
import { CrawlTask } from './crawl-task';

type PublicKey = string;

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
	private stellarMessageHandler: StellarMessageHandler;
	private disconnectTimeout: DisconnectTimeout;
	private _crawlState: CrawlState | null = null;

	constructor(
		private config: CrawlerConfiguration,
		private quorumSetManager: QuorumSetManager,
		private scpManager: ScpEnvelopeHandler,
		private readonly connectionManager: ConnectionManager,
		private crawlQueueManager: CrawlQueueManager,
		private readonly logger: P.Logger
	) {
		this.logger = logger.child({ mod: 'Crawler' });
		this.disconnectTimeout = new DisconnectTimeout(logger);
		this.stellarMessageHandler = new StellarMessageHandler(
			this.scpManager,
			this.quorumSetManager,
			this.logger
		);
		this.setupEventHandlers();
	}

	private setupEventHandlers() {
		this.setupStellarMessageHandlerEvents();
		this.setupConnectionManagerEvents();
	}

	private setupConnectionManagerEvents() {
		this.connectionManager.on('connected', (data: ConnectedPayload) => {
			this.onConnected(data.ip, data.port, data.publicKey, data.nodeInfo);
		});
		this.connectionManager.on('data', (data: DataPayload) => {
			this.onStellarMessage(data);
		});
		this.connectionManager.on('close', (data: ClosePayload) => {
			this.onConnectionClose(data.address, data.publicKey);
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
		topTierAddresses.forEach((address) => this.crawlPeerNode(address));
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
		this.logger.info('Crawl process complete');
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

	private crawlPeerNode(nodeAddress: NodeAddress): void {
		const crawlTask: CrawlTask = {
			nodeAddress: nodeAddress,
			crawlState: this.crawlState,
			connectCallback: () =>
				this.connectionManager.connectToNode(nodeAddress[0], nodeAddress[1])
		};

		this.crawlQueueManager.addCrawlTask(crawlTask);
	}

	/** EVENT HANDLING **/

	private onConnected(
		ip: string,
		port: number,
		publicKey: PublicKey,
		nodeInfo: NodeInfo
	): void {
		const peerNodeOrError = this.crawlState.peerNodes.addSuccessfullyConnected(
			publicKey,
			ip,
			port,
			nodeInfo
		);

		if (peerNodeOrError instanceof Error) {
			this.connectionManager.disconnectByAddress(
				`${ip}:${port}`,
				peerNodeOrError
			);
			return;
		}

		this.crawlQueueManager.determineWorkerTopTierStatus(
			ip,
			port,
			publicKey,
			this.crawlState.topTierNodes
		);

		this.setupConnectionSuccessActions(peerNodeOrError);
	}

	private setupConnectionSuccessActions(peerNode: PeerNode): void {
		this.disconnectTimeout.start(
			peerNode,
			0,
			this.crawlState,
			() => this.connectionManager.disconnectByAddress(peerNode.key),
			() => this.crawlQueueManager.readyWithNonTopTierPeers()
		);
		/*if (!this._nodesThatSuppliedPeerList.has(connection.peer)) { //Most nodes send their peers automatically on successful handshake, better handled with timer.
            this._connectionManager.sendGetPeers(connection);
        }*/
	}

	private onStellarMessage(data: DataPayload) {
		const result = this.stellarMessageHandler.handleStellarMessage(
			data.publicKey,
			data.stellarMessageWork.stellarMessage,
			this.crawlState
		);

		data.stellarMessageWork.done();

		if (result.isErr()) {
			this.logger.info({ peer: data.publicKey }, result.error.message);
			this.connectionManager.disconnectByAddress(data.address, result.error);
		}
	}

	private onConnectionClose(
		nodeAddress: string,
		publicKey: PublicKey | undefined
	): void {
		if (publicKey) {
			this.performCleanupForClosedConnection(publicKey, nodeAddress);
		} else {
			this.updateFailedConnections(nodeAddress);
		}

		this.crawlQueueManager.completeCrawlQueueTask(
			this.crawlState.crawlQueueTaskDoneCallbacks, //todo: Move
			nodeAddress
		);
	}

	private performCleanupForClosedConnection(
		publicKey: PublicKey,
		nodeAddress: string
	): void {
		this.quorumSetManager.onNodeDisconnected(publicKey, this.crawlState);
		const peer = this.crawlState.peerNodes.get(publicKey);
		if (peer && peer.key === nodeAddress) {
			const timeout = this.crawlState.listenTimeouts.get(publicKey);
			peer.disconnected = true;
			if (timeout) clearTimeout(timeout);
			this.crawlState.listenTimeouts.delete(publicKey);
		} //if peer.key differs from remoteAddress,then this is a connection to an ip that reuses a publicKey. These connections are ignored, and we should make sure we don't interfere with a possible connection to the other ip that uses the public key.
	}

	private updateFailedConnections(nodeAddress: string) {
		this.crawlState.failedConnections.push(nodeAddress);
	}
}
