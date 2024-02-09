import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { AsyncResultCallback, queue, QueueObject } from 'async';
import { NodeInfo } from '@stellarbeat/js-stellar-node-connector/lib/node';
import * as P from 'pino';
import { QuorumSetManager } from './quorum-set-manager';
import { CrawlState } from './crawl-state';
import { ScpManager } from './scp-manager';
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
}

/**
 * The Crawler manages the connections to every discovered Node Address. If a node is participating in SCP, it keeps listening until it can determine if it is validating correctly.
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
		private scpManager: ScpManager,
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

	get crawlState(): CrawlState {
		if (!this._crawlState) throw new Error('crawlState not set');
		return this._crawlState;
	}

	initCrawlState(
		topTierQuorumSet: QuorumSet,
		latestClosedLedger: Ledger = {
			sequence: BigInt(0),
			closeTime: new Date(0)
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
		latestClosedLedger: Ledger = {
			sequence: BigInt(0),
			closeTime: new Date(0)
		},
		quorumSets: Map<QuorumSetHash, QuorumSet> = new Map<
			QuorumSetHash,
			QuorumSet
		>()
	): Promise<CrawlResult> {
		this.initCrawlState(topTierQuorumSet, latestClosedLedger, quorumSets);

		return await new Promise<CrawlResult>((resolve, reject) => {
			const errorOrNull = CrawlStateValidator.validateCrawlState(
				//todo move to initCrawlState
				this.crawlState,
				this.config
			);
			if (errorOrNull) return reject(errorOrNull);

			const crawlLogger = new CrawlLogger(
				this.crawlState,
				this.connectionManager,
				this.crawlQueue,
				this.logger
			);
			crawlLogger.start(nodeAddresses.length);

			const maxCrawlTimeout = this.startMaxCrawlTimeout(this.crawlState);

			this.crawlQueue.drain(() => {
				clearTimeout(maxCrawlTimeout);
				this.wrapUp(resolve, reject, this.crawlState, crawlLogger);
			});

			nodeAddresses.forEach((address) => this.crawlPeerNode(address));
		});
	}

	private startMaxCrawlTimeout(crawlState: CrawlState) {
		return setTimeout(() => {
			this.logger.fatal('Max crawl time hit, closing all connections');
			this.connectionManager.shutdown();
			crawlState.maxCrawlTimeHit = true;
		}, this.config.maxCrawlTime);
	}

	protected crawlPeerNode(nodeAddress: NodeAddress): void {
		const peerKey = nodeAddressToPeerKey(nodeAddress);
		if (this.crawlState.crawledNodeAddresses.has(peerKey)) {
			this.logger.debug({ peer: peerKey }, 'Address already crawled');
			return;
		}

		this.logger.debug({ peer: peerKey }, 'Adding address to crawl queue');
		this.crawlState.crawledNodeAddresses.add(peerKey);
		this.crawlQueue.push(
			[
				{
					nodeAddress: nodeAddress,
					crawlState: this.crawlState
				}
			],
			(error) => {
				if (error) this.logger.error({ peer: peerKey }, error.message);
			}
		);
	}

	protected performCrawlQueueTask(
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
				ip + ':' + port,
				peerNodeOrError
			);
			return; //we don't return this peerNode to consumer of this library
		}

		this.crawlQueue.workersList().forEach((worker) => {
			if (
				worker.data.nodeAddress[0] === ip &&
				worker.data.nodeAddress[1] === port
			) {
				worker.data.topTier = this.crawlState.topTierNodes.has(publicKey);
			}
		});

		/*if (!this._nodesThatSuppliedPeerList.has(connection.peer)) { //Most nodes send their peers automatically on successful handshake, better handled with timer.
            this._connectionManager.sendGetPeers(connection);
        }*/

		//todo: split out timers!
		this.disconnectTimeout.start(
			peerNodeOrError,
			0,
			this.crawlState,
			() => this.connectionManager.disconnectByAddress(peerNodeOrError.key),
			this.readyWithNonTopTierPeers.bind(this)
		);
	}

	protected onConnectionClose(
		nodeAddress: string,
		publicKey: PublicKey | undefined
	): void {
		if (publicKey) {
			this.quorumSetManager.onNodeDisconnected(publicKey, this.crawlState);
			const peer = this.crawlState.peerNodes.get(publicKey);
			if (peer && peer.key === nodeAddress) {
				const timeout = this.crawlState.listenTimeouts.get(publicKey);
				if (timeout) clearTimeout(timeout);
			} //if peer.key differs from remoteAddress,then this is a connection to an ip that reuses a publicKey. These connections are ignored, and we should make sure we don't interfere with a possible connection to the other ip that uses the public key.
		} else {
			this.crawlState.failedConnections.push(nodeAddress);
		}

		const crawlQueueTaskDoneCallback =
			this.crawlState.crawlQueueTaskDoneCallbacks.get(nodeAddress);
		if (!crawlQueueTaskDoneCallback) {
			this.logger.error(
				{ peer: nodeAddress },
				'No crawlQueueTaskDoneCallback found'
			);
			return;
		}
		crawlQueueTaskDoneCallback();
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

	protected wrapUp(
		resolve: (value: CrawlResult | PromiseLike<CrawlResult>) => void,
		reject: (error: Error) => void,
		crawlState: CrawlState,
		crawlLogger: CrawlLogger
	): void {
		this.logger.info('Crawler shutting down');
		crawlLogger.stop();

		if (crawlState.maxCrawlTimeHit)
			reject(new Error('Max crawl time hit, closing crawler'));

		resolve({
			peers: crawlState.peerNodes.getAll(),
			closedLedgers: crawlState.slots.getClosedSlotIndexes(),
			latestClosedLedger: crawlState.latestClosedLedger
		});
	}
}
