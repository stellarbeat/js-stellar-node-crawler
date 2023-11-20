import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { AsyncResultCallback, queue, QueueObject } from 'async';

import {
	Connection,
	Node as NetworkNode,
	getIpFromPeerAddress,
	getQuorumSetFromMessage
} from '@stellarbeat/js-stellar-node-connector';

import { hash, xdr } from 'stellar-base';
import { PeerNode } from './peer-node';
import { NodeInfo } from '@stellarbeat/js-stellar-node-connector/lib/node';
import * as P from 'pino';
import { QuorumSetManager } from './quorum-set-manager';
import { CrawlState } from './crawl-state';
import { ScpManager } from './scp-manager';
import { NodeConfig } from '@stellarbeat/js-stellar-node-connector/lib/node-config';
import { StellarMessageWork } from '@stellarbeat/js-stellar-node-connector/lib/connection/connection';
import { listenFurther } from './listen-further';
import { truncate } from './truncate';

type PublicKey = string;
export type NodeAddress = [ip: string, port: number];

export interface CrawlResult {
	peers: Map<PublicKey, PeerNode>;
	closedLedgers: bigint[];
	latestClosedLedger: Ledger;
}

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

export interface CrawlerConfiguration {
	maxOpenConnections: number; //How many connections can be open at the same time. The higher the number, the faster the crawl
	nodeConfig: NodeConfig;
	maxCrawlTime: number; //max nr of ms the crawl will last. Safety guard in case crawler is stuck.
	blackList: Set<PublicKey>;
}

export class CrawlerConfiguration implements CrawlerConfiguration {
	constructor(
		public nodeConfig: NodeConfig,
		public maxOpenConnections = 25,
		public maxCrawlTime = 1800000,
		public blackList = new Set<PublicKey>()
	) {}
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

	protected static readonly SCP_LISTEN_TIMEOUT = 10000; //how long do we listen to determine if a node is participating in SCP. Correlated with Herder::EXP_LEDGER_TIMESPAN_SECONDS
	protected static readonly CONSENSUS_STUCK_TIMEOUT = 35000; //https://github.com/stellar/stellar-core/blob/2b16c2599e9167c67032b402b71e37d2bf1b15e3/src/herder/Herder.cpp#L9C36-L9C36
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
			this.processCrawlPeerNodeInCrawlQueue.bind(this),
			config.maxOpenConnections
		);
	}

	/*
	 * @param topTierQuorumSet QuorumSet of top tier nodes that the crawler should trust to close ledgers and determine the correct externalized value.
	 * Top tier nodes are trusted by everyone transitively, otherwise there would be no quorum intersection. Stellar core forwards scp messages of every transitively trusted node. Thus we can close ledgers when connecting to any node.
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
		console.time('crawl');
		const crawlState = new CrawlState(
			topTierQuorumSet,
			quorumSets,
			latestClosedLedger,
			this.logger
		); //todo dependency inversion?

		return await new Promise<CrawlResult>((resolve, reject) => {
			if (this.config.maxOpenConnections <= crawlState.topTierNodes.size)
				return reject(
					new Error(
						'Max open connections should be higher than top tier size: ' +
							crawlState.topTierNodes.size
					)
				);
			this.logger.info(
				'Starting crawl with seed of ' + nodeAddresses.length + 'addresses.'
			);
			crawlState.loggingTimer = setInterval(() => {
				this.logger.info(
					'nodes left in queue: ' +
						this.crawlQueue.length() +
						'. open connections: ' +
						crawlState.openConnections.size
				);
			}, 10000);

			const maxCrawlTimeout = setTimeout(() => {
				this.logger.fatal('Max crawl time hit, closing all connections');
				crawlState.openConnections.forEach((connection) =>
					this.disconnect(connection, crawlState)
				);
				crawlState.maxCrawlTimeHit = true;
			}, this.config.maxCrawlTime);
			this.crawlQueue.drain(() => {
				clearTimeout(maxCrawlTimeout);
				this.wrapUp(resolve, reject, crawlState);
			}); //when queue is empty, we wrap up the crawl
			nodeAddresses.forEach((address) =>
				this.crawlPeerNode(address, crawlState)
			);
		});
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

	protected processCrawlPeerNodeInCrawlQueue(
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
				this.disconnect(connection, crawlQueueTask.crawlState, error);
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
				this.onStellarMessage(
					connection,
					stellarMessageWork.stellarMessage,
					crawlQueueTask.crawlState
				);

				stellarMessageWork.done();
			})
			.on('timeout', () =>
				this.onTimeout(connection, crawlQueueTask.crawlState)
			)
			.on('close', () =>
				this.onConnectionClose(
					connection,
					crawlQueueTask.crawlState,
					crawlQueueTaskDone
				)
			);
	}

	protected onTimeout(connection: Connection, crawlState: CrawlState): void {
		this.logger.debug({ peer: connection.remoteAddress }, 'Connection timeout');
		this.disconnect(connection, crawlState);
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

			this.disconnect(connection, crawlState);

			return;
		}

		let peerNode = crawlState.peerNodes.get(publicKey);
		if (peerNode && peerNode.successfullyConnected) {
			//this public key is already used in this crawl! A node is not allowed to reuse public keys. Disconnecting.
			this.logger.info(
				{
					peer: connection.remoteAddress,
					pk: truncate(publicKey)
				},
				'PeerNode reusing publicKey on address ' + peerNode.key
			);

			this.disconnect(
				connection,
				crawlState,
				new Error('PeerNode reusing publicKey on address ' + peerNode.key)
			);
			return; //we don't return this peerNode to consumer of this library
		}

		if (!peerNode) {
			peerNode = new PeerNode(publicKey);
		}

		peerNode.nodeInfo = nodeInfo;
		peerNode.ip = connection.remoteIp;
		peerNode.port = connection.remotePort;

		crawlState.peerNodes.set(publicKey, peerNode);
		crawlState.openConnections.set(publicKey, connection);

		/*if (!this._nodesThatSuppliedPeerList.has(connection.peer)) { //Most nodes send their peers automatically on successful handshake, better handled with timer.
            this._connectionManager.sendGetPeers(connection);
        }*/

		this.listen(peerNode, connection, 0, crawlState);
	}

	protected onStellarMessage(
		connection: Connection,
		stellarMessage: xdr.StellarMessage,
		crawlState: CrawlState
	): void {
		switch (stellarMessage.switch()) {
			case xdr.MessageType.scpMessage(): {
				const result = this.scpManager.processScpEnvelope(
					stellarMessage.envelope(),
					crawlState
				);
				if (result.isErr())
					this.disconnect(connection, crawlState, result.error);
				break;
			}
			case xdr.MessageType.peers():
				this.onPeersReceived(connection, stellarMessage.peers(), crawlState);
				break;
			case xdr.MessageType.scpQuorumset():
				this.onQuorumSetReceived(connection, stellarMessage.qSet(), crawlState);
				break;
			case xdr.MessageType.dontHave(): {
				this.logger.info(
					{
						pk: truncate(connection.remotePublicKey),
						type: stellarMessage.dontHave().type().name
					},
					"Don't have"
				);
				if (
					stellarMessage.dontHave().type().value ===
					xdr.MessageType.getScpQuorumset().value
				) {
					this.logger.info(
						{
							pk: truncate(connection.remotePublicKey),
							hash: stellarMessage.dontHave().reqHash().toString('base64')
						},
						"Don't have"
					);
					if (connection.remotePublicKey) {
						this.quorumSetManager.peerNodeDoesNotHaveQuorumSet(
							connection.remotePublicKey,
							stellarMessage.dontHave().reqHash().toString('base64'),
							crawlState
						);
					}
				}
				break;
			}
			case xdr.MessageType.errorMsg():
				this.onStellarMessageErrorReceived(
					connection,
					stellarMessage.error(),
					crawlState
				);
				break;
		}
	}

	protected onStellarMessageErrorReceived(
		connection: Connection,
		errorMessage: xdr.Error,
		crawlState: CrawlState
	): void {
		switch (errorMessage.code()) {
			case xdr.ErrorCode.errLoad():
				this.onLoadTooHighReceived(connection, crawlState);
				break;
			default:
				this.logger.info(
					{
						pk: truncate(connection.remotePublicKey),
						peer: connection.remoteIp + ':' + connection.remotePort,
						error: errorMessage.code().name
					},
					errorMessage.msg().toString()
				);
				break;
		}

		this.disconnect(
			connection,
			crawlState,
			new Error(errorMessage.msg().toString())
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
			} //if peer.key differs from remoteAddress,then this is a connection to an ip that reuses a publicKey. These connections are ignored and we should make sure we don't interfere with a possible connection to the other ip that uses the public key.
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

	protected onPeersReceived(
		connection: Connection,
		peers: xdr.PeerAddress[],
		crawlState: CrawlState
	): void {
		const peerAddresses: Array<NodeAddress> = [];
		peers.forEach((peer) => {
			const ipResult = getIpFromPeerAddress(peer);
			if (ipResult.isOk()) peerAddresses.push([ipResult.value, peer.port()]);
		});

		this.logger.debug(
			{ peer: connection.remoteAddress },
			peerAddresses.length + ' peers received'
		);

		if (connection.remotePublicKey) {
			const peer = crawlState.peerNodes.get(connection.remotePublicKey);
			if (peer) peer.suppliedPeerList = true;
		}

		peerAddresses.forEach((peerAddress) =>
			this.crawlPeerNode(peerAddress, crawlState)
		);
	}

	protected onLoadTooHighReceived(
		connection: Connection,
		crawlState: CrawlState
	): void {
		this.logger.debug(
			{ peer: connection.remoteAddress },
			'Load too high message received'
		);
		if (connection.remotePublicKey) {
			const node = crawlState.peerNodes.get(connection.remotePublicKey);
			if (node) {
				node.overLoaded = true;
			}
		}
	}

	protected onQuorumSetReceived(
		connection: Connection,
		quorumSetMessage: xdr.ScpQuorumSet,
		crawlState: CrawlState
	): void {
		const quorumSetHash = hash(quorumSetMessage.toXDR()).toString('base64');
		const quorumSetResult = getQuorumSetFromMessage(quorumSetMessage);
		if (quorumSetResult.isErr()) {
			this.disconnect(connection, crawlState, quorumSetResult.error);
			return;
		}
		this.logger.info(
			{
				pk: truncate(connection.remotePublicKey),
				hash: quorumSetHash
			},
			'QuorumSet received'
		);
		if (connection.remotePublicKey)
			this.quorumSetManager.processQuorumSet(
				quorumSetHash,
				QuorumSet.fromBaseQuorumSet(quorumSetResult.value),
				connection.remotePublicKey,
				crawlState
			);
	}

	protected disconnect(
		connection: Connection,
		crawlState: CrawlState,
		error?: Error
	): void {
		this.logger.trace(
			{
				peer: connection.remoteAddress,
				pk: truncate(connection.remotePublicKey),
				error: error?.message
			},
			'Disconnecting'
		);

		//destroy should always trigger close event, where connection cleanup already happens
		/*if (connection.remotePublicKey) {
			crawlState.openConnections.delete(connection.remotePublicKey); //we don't want to send any more commands
			const timeout = crawlState.listenTimeouts.get(connection.remotePublicKey);
			if (timeout) clearTimeout(timeout);
		}*/

		connection.destroy();
	}

	protected listen(
		peer: PeerNode,
		connection: Connection,
		timeoutCounter = 0,
		crawlState: CrawlState
	): void {
		if (
			!listenFurther(
				peer,
				timeoutCounter,
				//we wait max twice CONSENSUS_STUCK_TIMEOUT to ensure we receive al externalizing messages from straggling nodes;
				Math.ceil(
					(2 * Crawler.CONSENSUS_STUCK_TIMEOUT) / Crawler.SCP_LISTEN_TIMEOUT
				),
				crawlState.topTierNodes,
				this.readyWithNonTopTierPeers(),
				crawlState.peerNodes
			)
		) {
			this.logger.debug(
				{
					pk: truncate(peer.publicKey),
					counter: timeoutCounter,
					validating: peer.isValidating,
					validatingIncorrectly: peer.isValidatingIncorrectValues,
					scp: peer.participatingInSCP
				},
				'Disconnect'
			);
			this.disconnect(connection, crawlState);
			return;
		}
		this.logger.debug(
			{
				pk: truncate(peer.publicKey),
				latestActiveSlotIndex: peer.latestActiveSlotIndex
			},
			'Listening for externalize msg'
		);
		crawlState.listenTimeouts.set(
			peer.publicKey,
			setTimeout(() => {
				this.logger.debug(
					{ pk: truncate(peer.publicKey) },
					'SCP Listen timeout reached'
				);
				timeoutCounter++;
				this.listen(peer, connection, timeoutCounter, crawlState);
			}, Crawler.SCP_LISTEN_TIMEOUT)
		);
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
		crawlState: CrawlState
	): void {
		if (crawlState.loggingTimer) clearInterval(crawlState.loggingTimer);
		this.logger.info(
			{ peers: crawlState.failedConnections },
			'Failed connections'
		);
		crawlState.peerNodes.forEach((peer) => {
			this.logger.info({
				ip: peer.key,
				pk: truncate(peer.publicKey),
				connected: peer.successfullyConnected,
				scp: peer.participatingInSCP,
				validating: peer.isValidating,
				overLoaded: peer.overLoaded
			});
		});
		this.logger.info('processed all nodes in queue');
		this.logger.info(
			'Connection attempts: ' + crawlState.crawledNodeAddresses.size
		);
		this.logger.info('Detected public keys: ' + crawlState.peerNodes.size);
		this.logger.info(
			'Successful connections: ' +
				Array.from(crawlState.peerNodes.values()).filter(
					(peer) => peer.successfullyConnected
				).length
		);
		this.logger.info(
			'Validating nodes: ' +
				Array.from(crawlState.peerNodes.values()).filter(
					(node) => node.isValidating
				).length
		);
		this.logger.info(
			'Overloaded nodes: ' +
				Array.from(crawlState.peerNodes.values()).filter(
					(node) => node.overLoaded
				).length
		);

		this.logger.info(
			'Closed ledgers: ' + crawlState.slots.getClosedSlotIndexes().length
		);
		this.logger.info(
			Array.from(crawlState.peerNodes.values()).filter(
				(node) => node.suppliedPeerList
			).length + ' supplied us with a peers list.'
		);

		console.timeEnd('crawl');

		if (crawlState.maxCrawlTimeHit)
			reject(new Error('Max crawl time hit, closing crawler'));

		resolve({
			peers: crawlState.peerNodes,
			closedLedgers: crawlState.slots.getClosedSlotIndexes(),
			latestClosedLedger: crawlState.latestClosedLedger
		});
	}
}
