import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { AsyncResultCallback, queue, QueueObject } from 'async';
import { NodeInfo } from '@stellarbeat/js-stellar-node-connector/lib/node';
import * as P from 'pino';
import { QuorumSetManager } from './quorum-set-manager';
import { CrawlState } from './crawl-state';
import { ScpEnvelopeHandler } from './scp-envelope-handler';
import { CrawlResult } from './crawl-result';
import { CrawlerConfiguration } from './crawler-configuration';
import { CrawlStateValidator } from './crawl-state-validator';
import { CrawlLogger } from './crawl-logger';
import { DisconnectTimeout } from './disconnect-timeout';
import {
	PeerAddressesReceivedEvent,
	StellarMessageHandler
} from './stellar-message-handler';
import {
	ClosePayload,
	ConnectedPayload,
	ConnectionManager,
	DataPayload
} from './connection-manager';
import { PeerNode } from './peer-node';

type PublicKey = string;
export type NodeAddress = [ip: string, port: number];

function nodeAddressToPeerKey(nodeAddress: NodeAddress) {
	return nodeAddress[0] + ':' + nodeAddress[1];
}

type QuorumSetHash = string;

interface CrawlQueueTask {
	nodeAddress: NodeAddress;
	crawlState: CrawlState;
	topTier?: boolean;
}

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
	protected logger: P.Logger;
	protected crawlQueue: QueueObject<CrawlQueueTask>;
	private stellarMessageHandler: StellarMessageHandler;
	private disconnectTimeout: DisconnectTimeout;
	private _crawlState: CrawlState | null = null;

	constructor(
		private config: CrawlerConfiguration,
		private quorumSetManager: QuorumSetManager,
		private scpManager: ScpEnvelopeHandler,
		private readonly connectionManager: ConnectionManager,
		logger: P.Logger
	) {
		this.logger = logger.child({ mod: 'Crawler' });
		this.crawlQueue = queue(
			this.performCrawlQueueTask.bind(this),
			config.maxOpenConnections
		);
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
			(event: PeerAddressesReceivedEvent) => {
				event.peerAddresses.forEach((peerAddress) =>
					this.crawlPeerNode(peerAddress)
				);
			}
		);
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
		this._crawlState = new CrawlState(
			topTierQuorumSet,
			quorumSets,
			latestClosedLedger,
			this.config.nodeConfig.network,
			this.logger
		);
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
		this.initializeCrawlState(topTierQuorumSet, latestClosedLedger, quorumSets);

		return await new Promise<CrawlResult>((resolve, reject) => {
			const errorOrNull = CrawlStateValidator.validateCrawlState(
				//todo move to initCrawlState
				this.crawlState,
				this.config
			);
			if (errorOrNull) return reject(errorOrNull);

			const crawlLogger = this.initializeCrawlLogger(nodeAddresses);

			setTimeout(
				() =>
					this.startCrawlProcess(
						resolve,
						reject,
						crawlLogger,
						topTierNodeAddresses.concat(nodeAddresses) //top tier first
					),
				5000
			);
		});
	}

	private startCrawlProcess(
		resolve: (value: PromiseLike<CrawlResult> | CrawlResult) => void,
		reject: (reason?: any) => void,
		crawlLogger: CrawlLogger,
		nodeAddresses: NodeAddress[]
	) {
		this.setupCrawlCompletionHandlers(resolve, reject, crawlLogger);
		nodeAddresses.forEach((address) => this.crawlPeerNode(address));
	}

	private setupCrawlCompletionHandlers(
		resolve: (value: PromiseLike<CrawlResult> | CrawlResult) => void,
		reject: (reason?: any) => void,
		crawlLogger: CrawlLogger
	) {
		const maxCrawlTimeout = this.startMaxCrawlTimeout(this.crawlState);
		this.crawlQueue.drain(() => {
			clearTimeout(maxCrawlTimeout);
			this.completeCrawlProcess(resolve, reject, crawlLogger);
		});
	}

	private initializeCrawlLogger(nodeAddresses: NodeAddress[]) {
		const crawlLogger = new CrawlLogger(
			this.crawlState,
			this.connectionManager,
			this.crawlQueue,
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
			closedLedgers: this.crawlState.slots.getClosedSlotIndexes(),
			latestClosedLedger: this.crawlState.latestClosedLedger
		};
	}

	private crawlPeerNode(nodeAddress: NodeAddress): void {
		const peerKey = nodeAddressToPeerKey(nodeAddress);
		const alreadyCrawled = this.hasNodeBeenCrawled(peerKey);

		this.logNodeAddition(peerKey, alreadyCrawled);

		if (!alreadyCrawled) {
			this.crawlState.crawledNodeAddresses.add(peerKey);
			this.addNodeToCrawlQueue(nodeAddress);
		}
	}

	private hasNodeBeenCrawled(peerKey: string): boolean {
		return this.crawlState.crawledNodeAddresses.has(peerKey);
	}

	private logNodeAddition(peerKey: string, alreadyCrawled: boolean): void {
		if (alreadyCrawled) {
			this.logger.debug({ peer: peerKey }, 'Address already crawled');
		} else {
			this.logger.debug({ peer: peerKey }, 'Adding address to crawl queue');
		}
	}

	private addNodeToCrawlQueue(nodeAddress: NodeAddress): void {
		const crawlTask: CrawlQueueTask = {
			nodeAddress: nodeAddress,
			crawlState: this.crawlState
		};
		this.crawlQueue.push([crawlTask], (error) => {
			if (error) {
				this.logger.error(
					{ peer: nodeAddressToPeerKey(nodeAddress) },
					error.message
				);
			}
		});
	}

	private performCrawlQueueTask(
		crawlQueueTask: CrawlQueueTask,
		crawlQueueTaskDone: AsyncResultCallback<void>
	): void {
		this.crawlState.crawlQueueTaskDoneCallbacks.set(
			crawlQueueTask.nodeAddress.join(':'),
			crawlQueueTaskDone
		);
		this.connectionManager.connectToNode(
			crawlQueueTask.nodeAddress[0],
			crawlQueueTask.nodeAddress[1]
		);
	}

	/** EVENT HANDLING **/

	private onConnected(
		ip: string,
		port: number,
		publicKey: PublicKey,
		nodeInfo: NodeInfo
	): void {
		const peerNodeOrError = this.processSuccessfulConnection(
			ip,
			port,
			publicKey,
			nodeInfo
		);

		if (peerNodeOrError instanceof Error) {
			this.handleConnectionError(ip, port, peerNodeOrError);
			return;
		}

		this.determineWorkerTopTierStatus(ip, port, publicKey);
		this.setupConnectionSuccessActions(peerNodeOrError);
	}

	private determineWorkerTopTierStatus(
		ip: string,
		port: number,
		publicKey: string
	) {
		this.crawlQueue.workersList().forEach((worker) => {
			if (
				worker.data.nodeAddress[0] === ip &&
				worker.data.nodeAddress[1] === port
			) {
				worker.data.topTier = this.crawlState.topTierNodes.has(publicKey);
			}
		});
	}

	private processSuccessfulConnection(
		ip: string,
		port: number,
		publicKey: PublicKey,
		nodeInfo: NodeInfo
	): Error | PeerNode {
		return this.crawlState.peerNodes.addSuccessfullyConnected(
			publicKey,
			ip,
			port,
			nodeInfo
		);
	}

	private handleConnectionError(ip: string, port: number, error: Error): void {
		this.connectionManager.disconnectByAddress(`${ip}:${port}`, error);
	}

	private setupConnectionSuccessActions(peerNode: PeerNode): void {
		this.disconnectTimeout.start(
			peerNode,
			0,
			this.crawlState,
			() => this.connectionManager.disconnectByAddress(peerNode.key),
			this.readyWithNonTopTierPeers.bind(this)
		);
		/*if (!this._nodesThatSuppliedPeerList.has(connection.peer)) { //Most nodes send their peers automatically on successful handshake, better handled with timer.
            this._connectionManager.sendGetPeers(connection);
        }*/
	}

	private onConnectionClose(
		nodeAddress: string,
		publicKey: PublicKey | undefined
	): void {
		if (publicKey) {
			this.performCleanupForDisconnectedNode(publicKey, nodeAddress);
		} else {
			this.updateFailedConnections(nodeAddress);
		}

		this.completeCrawlQueueTask(nodeAddress);
	}

	private completeCrawlQueueTask(nodeAddress: string): void {
		const taskDoneCallback =
			this.crawlState.crawlQueueTaskDoneCallbacks.get(nodeAddress);
		if (taskDoneCallback) {
			taskDoneCallback();
			this.crawlState.crawlQueueTaskDoneCallbacks.delete(nodeAddress);
		} else {
			this.logger.error(
				{ peer: nodeAddress },
				'No crawlQueueTaskDoneCallback found'
			);
		}
	}

	private updateFailedConnections(nodeAddress: string) {
		this.crawlState.failedConnections.push(nodeAddress);
	}

	private performCleanupForDisconnectedNode(
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

	private readyWithNonTopTierPeers(): boolean {
		if (this.crawlQueue.length() !== 0) return false; //we don't know yet because there are still peers left to be crawled

		return !this.workersListContainsNonTopTierPeers();
	}

	private workersListContainsNonTopTierPeers() {
		return this.crawlQueue.workersList().some((worker) => {
			return worker.data.topTier !== true;
		});
	}
}
