import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { AsyncResultCallback, queue, QueueObject } from 'async';
import {
	Connection,
	Node as NetworkNode
} from '@stellarbeat/js-stellar-node-connector';
import { NodeInfo } from '@stellarbeat/js-stellar-node-connector/lib/node';
import * as P from 'pino';
import { QuorumSetManager } from './quorum-set-manager';
import { CrawlState } from './crawl-state';
import { ScpManager } from './scp-manager';
import { StellarMessageWork } from '@stellarbeat/js-stellar-node-connector/lib/connection/connection';
import { truncate } from './truncate';
import { CrawlResult } from './crawl-result';
import { CrawlerConfiguration } from './crawler-configuration';
import { CrawlStateValidator } from './crawl-state-validator';
import { CrawlLogger } from './crawl-logger';
import { DisconnectTimeout } from './disconnect-timeout';
import { StellarMessageHandler } from './stellar-message-handler';

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
	protected quorumSetManager: QuorumSetManager;
	protected scpManager: ScpManager;
	protected crawlerNode: NetworkNode;
	protected logger: P.Logger;
	protected config: CrawlerConfiguration;
	protected crawlQueue: QueueObject<CrawlQueueTask>;
	protected blackList: Set<PublicKey>;

	private stellarMessageHandler: StellarMessageHandler;
	private disconnectTimeout: DisconnectTimeout;

	constructor(
		config: CrawlerConfiguration,
		node: NetworkNode,
		quorumSetManager: QuorumSetManager,
		scpManager: ScpManager,
		logger: P.Logger
	) {
		this.scpManager = scpManager;
		this.config = config;
		this.logger = logger.child({ mod: 'Crawler' });
		this.quorumSetManager = quorumSetManager;
		this.crawlerNode = node;
		this.blackList = config.blackList;
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
	}

	private setupStellarMessageHandlerEvents() {
		this.stellarMessageHandler.on(
			'peerAddresses',
			(data: {
				from: PublicKey | undefined;
				peerAddresses: NodeAddress[];
				crawlState: CrawlState;
			}) => {
				if (data.from) {
					const peer = data.crawlState.peerNodes.get(data.from);
					if (peer) peer.suppliedPeerList = true;
				}
				data.peerAddresses.forEach((peerAddress) =>
					this.crawlPeerNode(peerAddress, data.crawlState)
				);
			}
		);
		this.stellarMessageHandler.on('disconnect', (connection: Connection) => {
			this.disconnect(connection);
		});
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
		const crawlState = new CrawlState(
			topTierQuorumSet,
			quorumSets,
			latestClosedLedger,
			this.logger
		); //todo dependency inversion?

		return await new Promise<CrawlResult>((resolve, reject) => {
			const errorOrNull = CrawlStateValidator.validateCrawlState(
				crawlState,
				this.config
			);
			if (errorOrNull) return reject(errorOrNull);

			const crawlLogger = new CrawlLogger(
				crawlState,
				this.crawlQueue,
				this.logger
			);
			crawlLogger.start(nodeAddresses.length);

			const maxCrawlTimeout = this.startMaxCrawlTimeout(crawlState);

			this.crawlQueue.drain(() => {
				clearTimeout(maxCrawlTimeout);
				this.wrapUp(resolve, reject, crawlState, crawlLogger);
			});

			nodeAddresses.forEach((address) =>
				this.crawlPeerNode(address, crawlState)
			);
		});
	}

	private startMaxCrawlTimeout(crawlState: CrawlState) {
		return setTimeout(() => {
			this.logger.fatal('Max crawl time hit, closing all connections');
			crawlState.openConnections.forEach((connection) =>
				this.disconnect(connection)
			);
			crawlState.maxCrawlTimeHit = true;
		}, this.config.maxCrawlTime);
	}

	protected crawlPeerNode(
		nodeAddress: NodeAddress,
		crawlState: CrawlState
	): void {
		const peerKey = nodeAddressToPeerKey(nodeAddress);
		if (crawlState.crawledNodeAddresses.has(peerKey)) {
			this.logger.debug({ peer: peerKey }, 'Address already crawled');
			return;
		}

		this.logger.debug({ peer: peerKey }, 'Adding address to crawl queue');
		crawlState.crawledNodeAddresses.add(peerKey);
		this.crawlQueue.push(
			[
				{
					nodeAddress: nodeAddress,
					crawlState: crawlState
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
		const connection = this.crawlerNode.connectTo(
			crawlQueueTask.nodeAddress[0],
			crawlQueueTask.nodeAddress[1]
		);
		this.logger.debug({ peer: connection.remoteAddress }, 'Connecting');

		connection
			.on('error', (error: Error) => {
				this.logger.debug(
					{ peer: connection.remoteAddress },
					'error: ' + error.message
				);
				this.disconnect(connection, error);
			})
			.on('connect', (publicKey: string, nodeInfo: NodeInfo) => {
				crawlQueueTask.topTier =
					crawlQueueTask.crawlState.topTierNodes.has(publicKey);
				this.onConnected(
					connection,
					publicKey,
					nodeInfo,
					crawlQueueTask.crawlState
				);
			})
			.on('data', (stellarMessageWork: StellarMessageWork) => {
				this.stellarMessageHandler.handleStellarMessage(
					connection,
					stellarMessageWork,
					crawlQueueTask.crawlState
				);
			})
			.on('timeout', () => this.onTimeout(connection))
			.on('close', () =>
				this.onConnectionClose(
					connection,
					crawlQueueTask.crawlState,
					crawlQueueTaskDone
				)
			);
	}

	protected onTimeout(connection: Connection): void {
		this.logger.debug({ peer: connection.remoteAddress }, 'Connection timeout');
		this.disconnect(connection);
	}

	protected onConnected(
		connection: Connection,
		publicKey: PublicKey,
		nodeInfo: NodeInfo,
		crawlState: CrawlState
	): void {
		this.logger.debug(
			{ peer: connection.remoteAddress, pk: truncate(publicKey) },
			'Connected'
		);

		if (this.blackList.has(publicKey)) {
			this.logger.info(
				{
					peer: connection.remoteAddress,
					pk: truncate(publicKey)
				},
				'PeerNode on blacklist' + publicKey
			);

			this.disconnect(connection);

			return;
		}

		const peerNodeOrError = crawlState.peerNodes.addSuccessfullyConnected(
			publicKey,
			connection.remoteIp,
			connection.remotePort,
			nodeInfo
		);

		if (peerNodeOrError instanceof Error) {
			this.disconnect(
				connection,
				new Error(
					'PeerNode reusing publicKey on address ' + connection.remoteAddress
				)
			);
			return; //we don't return this peerNode to consumer of this library
		}

		crawlState.openConnections.set(publicKey, connection);

		/*if (!this._nodesThatSuppliedPeerList.has(connection.peer)) { //Most nodes send their peers automatically on successful handshake, better handled with timer.
            this._connectionManager.sendGetPeers(connection);
        }*/

		this.disconnectTimeout.start(
			peerNodeOrError,
			0,
			crawlState,
			() => this.disconnect(connection),
			this.readyWithNonTopTierPeers.bind(this)
		);
	}

	protected onConnectionClose(
		connection: Connection,
		crawlState: CrawlState,
		crawlQueueTaskDone: AsyncResultCallback<void>
	): void {
		this.logger.debug(
			{
				pk: truncate(connection.remotePublicKey),
				peer: connection.remoteAddress
			},
			'Node disconnected'
		);

		if (connection.remotePublicKey) {
			this.quorumSetManager.onNodeDisconnected(
				connection.remotePublicKey,
				crawlState
			);
			const peer = crawlState.peerNodes.get(connection.remotePublicKey);
			if (peer && peer.key === connection.remoteAddress) {
				const timeout = crawlState.listenTimeouts.get(
					connection.remotePublicKey
				);
				if (timeout) clearTimeout(timeout);
				crawlState.openConnections.delete(connection.remotePublicKey);
			} //if peer.key differs from remoteAddress,then this is a connection to an ip that reuses a publicKey. These connections are ignored, and we should make sure we don't interfere with a possible connection to the other ip that uses the public key.
		} else {
			crawlState.failedConnections.push(connection.remoteAddress);
			this.logger.debug(
				{
					ip: connection.remoteAddress,
					leftInQueue: this.crawlQueue.length()
				},
				'handshake failed'
			);
		}

		crawlQueueTaskDone();
	}

	protected disconnect(connection: Connection, error?: Error): void {
		if (error) {
			this.logger.debug(
				{
					peer: connection.remoteAddress,
					pk: truncate(connection.remotePublicKey),
					error: error.message
				},
				'Disconnecting'
			);
		} else {
			this.logger.trace(
				{
					peer: connection.remoteAddress,
					pk: truncate(connection.remotePublicKey)
				},
				'Disconnecting'
			);
		}

		connection.destroy();
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
