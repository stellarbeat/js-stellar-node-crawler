import { QuorumSet } from '@stellarbeat/js-stellar-domain';
import { AsyncResultCallback, queue, QueueObject } from 'async';

import {
	Connection,
	Node as NetworkNode,
	getConfigFromEnv,
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
}

export interface Ledger {
	sequence: bigint;
	closeTime: Date;
}

export interface CrawlerConfiguration {
	usePublicNetwork: boolean;
	maxOpenConnections: number; //How many connections can be open at the same time. The higher the number, the faster the crawl
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

	protected static readonly SCP_LISTEN_TIMEOUT = 5000; //how long do we listen to determine if a node is participating in SCP. Correlated with Herder::EXP_LEDGER_TIMESPAN_SECONDS

	constructor(
		config: CrawlerConfiguration,
		quorumSetManager: QuorumSetManager,
		scpManager: ScpManager,
		logger: P.Logger
	) {
		this.scpManager = scpManager;
		this.config = config;
		this.logger = logger.child({ mod: 'Crawler' });
		this.quorumSetManager = quorumSetManager;
		this.crawlerNode = new NetworkNode( //todo inject
			config.usePublicNetwork,
			getConfigFromEnv(), //todo: inject crawler config (or maybe crawlerNode itself?);
			logger
		);

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
		let crawlState = new CrawlState(
			topTierQuorumSet,
			quorumSets,
			latestClosedLedger
		); //todo dependency inversion?
		this.logger.info(
			'Starting crawl with seed of ' + nodeAddresses.length + 'addresses.'
		);

		return await new Promise<CrawlResult>(async (resolve) => {
			this.crawlQueue.drain(() => {
				this.wrapUp(resolve, crawlState);
			}); //when queue is empty, we wrap up the crawl
			nodeAddresses.forEach((address) =>
				this.crawlPeerNode(address, crawlState)
			);
		});
	}

	protected crawlPeerNode(nodeAddress: NodeAddress, crawlState: CrawlState) {
		let peerKey = nodeAddressToPeerKey(nodeAddress);
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
		crawlQueueTaskDone: AsyncResultCallback<any>
	) {
		try {
			let connection = this.crawlerNode.connectTo(
				crawlQueueTask.nodeAddress[0],
				crawlQueueTask.nodeAddress[1]
			);
			this.logger.info({ peer: connection.remoteAddress }, 'Connecting');

			connection
				.on('error', (error: Error) => {
					this.logger.debug(
						{ peer: connection.remoteAddress },
						'error: ' + error.message
					);
					this.disconnect(connection, crawlQueueTask.crawlState, error);
				})
				.on('connect', (publicKey: string, nodeInfo: NodeInfo) =>
					this.onConnected(
						connection,
						publicKey,
						nodeInfo,
						crawlQueueTask.crawlState
					)
				)
				.on('data', (stellarMessage: xdr.StellarMessage) =>
					this.onStellarMessage(
						connection,
						stellarMessage,
						crawlQueueTask.crawlState
					)
				)
				.on('timeout', () => this.onTimeout(connection))
				.on('close', () =>
					this.onNodeDisconnected(
						connection,
						crawlQueueTask.crawlState,
						crawlQueueTaskDone
					)
				);
		} catch (error: any) {
			this.logger.error(
				{
					peer:
						crawlQueueTask.nodeAddress[0] + ':' + crawlQueueTask.nodeAddress[1]
				},
				error.message
			);
		}
	}

	protected onTimeout(connection: Connection) {
		this.logger.debug({ peer: connection.remoteAddress }, 'Connection timeout');
		connection.destroy();
	}

	protected onConnected(
		connection: Connection,
		publicKey: PublicKey,
		nodeInfo: NodeInfo,
		crawlState: CrawlState
	) {
		try {
			this.logger.info(
				{ peer: connection.remoteAddress, pk: publicKey },
				'Connected'
			);

			let peerNode = crawlState.peerNodes.get(publicKey);
			if (peerNode && peerNode.successfullyConnected) {
				//this public key is already used in this crawl! A node is not allowed to reuse public keys. Disconnecting.
				this.logger.error(
					{
						peer: connection.remoteAddress,
						pk: publicKey
					},
					'PeerNode reusing publicKey on address ' +
						crawlState.peerNodes.get(publicKey)!.key
				);
				connection.destroy();
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

			this.quorumSetManager.connectedToPeerNode(peerNode, crawlState);

			/*if (!this._nodesThatSuppliedPeerList.has(connection.peer)) { //Most nodes send their peers automatically on successful handshake, better handled with timer.
                this._connectionManager.sendGetPeers(connection);
            }*/

			this.listen(peerNode, connection, 0, crawlState);
		} catch (error: any) {
			this.logger.error({ peer: connection.remoteAddress }, error.message);
		}
	}

	protected onStellarMessage(
		connection: Connection,
		stellarMessage: xdr.StellarMessage,
		crawlState: CrawlState
	) {
		switch (stellarMessage.switch()) {
			case xdr.MessageType.scpMessage():
				let result = this.scpManager.processScpEnvelope(
					stellarMessage.envelope(),
					crawlState
				);
				if (result.isErr())
					this.disconnect(connection, crawlState, result.error);
				break;
			case xdr.MessageType.peers():
				this.onPeersReceived(connection, stellarMessage.peers(), crawlState);
				break;
			case xdr.MessageType.scpQuorumset():
				this.onQuorumSetReceived(connection, stellarMessage.qSet(), crawlState);
				break;
			case xdr.MessageType.dontHave():
				this.logger.info(
					{
						pk: connection.remotePublicKey,
						type: stellarMessage.dontHave().type().name
					},
					"Don't have"
				);
				if (
					stellarMessage.dontHave().type().value ===
					xdr.MessageType.getScpQuorumset().value
				) {
					this.logger.info(
						{ pk: connection.remotePublicKey, hash: hash },
						"Don't have"
					);
					this.quorumSetManager.peerNodeDoesNotHaveQuorumSet(
						connection.remotePublicKey!,
						crawlState
					);
				}
				break;
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
	) {
		switch (errorMessage.code()) {
			case xdr.ErrorCode.errLoad():
				this.onLoadTooHighReceived(connection, crawlState);
				break;
			default:
				this.logger.info(
					{
						pk: connection.remotePublicKey,
						peer: connection.remoteIp + ':' + connection.remotePort,
						error: errorMessage.code().name
					},
					errorMessage.msg().toString()
				);
				break;
		}

		connection.destroy(new Error(errorMessage.msg().toString()));
	}

	protected onNodeDisconnected(
		connection: Connection,
		crawlState: CrawlState,
		crawlQueueTaskDone: AsyncResultCallback<any>
	) {
		try {
			this.logger.info(
				{ pk: connection.remotePublicKey, peer: connection.remoteAddress },
				'Node disconnected'
			);
			if (
				connection.remotePublicKey &&
				crawlState.listenTimeouts.get(connection.remotePublicKey)
			)
				clearTimeout(crawlState.listenTimeouts.get(connection.remotePublicKey));

			crawlState.openConnections.delete(connection.remotePublicKey!);
			this.quorumSetManager.peerNodeDisconnected(
				connection.remotePublicKey!,
				crawlState
			); //just in case a request to this node was happening
			this.logger.debug('nodes left in queue: ' + this.crawlQueue.length());
			crawlQueueTaskDone();
		} catch (error: any) {
			this.logger.error(
				{ peer: connection.remoteAddress },
				'Exception: ' + error.message
			);
			crawlQueueTaskDone(error);
		}
	}

	protected onPeersReceived(
		connection: Connection,
		peers: xdr.PeerAddress[],
		crawlState: CrawlState
	) {
		let peerAddresses: Array<NodeAddress> = [];
		peers.forEach((peer) => {
			let ipResult = getIpFromPeerAddress(peer);
			if (ipResult.isOk()) peerAddresses.push([ipResult.value, peer.port()]);
		});

		this.logger.debug(
			{ peer: connection.remoteAddress },
			peerAddresses.length + ' peers received'
		);
		let peer = crawlState.peerNodes.get(connection.remotePublicKey!)!;
		peer.suppliedPeerList = true;
		peerAddresses.forEach((peerAddress) =>
			this.crawlPeerNode(peerAddress, crawlState)
		);
	}

	protected onLoadTooHighReceived(
		connection: Connection,
		crawlState: CrawlState
	) {
		try {
			this.logger.info(
				{ peer: connection.remoteAddress },
				'Load too high message received'
			);
			if (connection.remotePublicKey) {
				let node = crawlState.peerNodes.get(connection.remotePublicKey);
				if (node) {
					node.overLoaded = true;
				}
			}
		} catch (error: any) {
			this.logger.error({ peer: connection.remoteAddress }, error.message);
		}
	}

	protected onQuorumSetReceived(
		connection: Connection,
		quorumSetMessage: xdr.ScpQuorumSet,
		crawlState: CrawlState
	) {
		let quorumSetResult = getQuorumSetFromMessage(quorumSetMessage);
		if (quorumSetResult.isErr()) {
			connection.destroy(quorumSetResult.error);
			return;
		}
		this.logger.info(
			{
				pk: connection.remotePublicKey,
				hash: quorumSetResult.value.hashKey!
			},
			'QuorumSet received'
		);
		this.quorumSetManager.processQuorumSet(
			quorumSetResult.value,
			connection.remotePublicKey!,
			crawlState
		);
	}

	protected disconnect(
		connection: Connection,
		crawlState: CrawlState,
		error?: Error
	) {
		this.logger.debug(
			{
				peer: connection.remoteAddress,
				error: error?.message
			},
			'Disconnecting'
		);
		crawlState.openConnections.delete(connection.remotePublicKey!); //we don't want to send any more commands
		if (
			connection.remotePublicKey &&
			crawlState.listenTimeouts.get(connection.remotePublicKey)
		)
			clearTimeout(crawlState.listenTimeouts.get(connection.remotePublicKey));
		connection.destroy(error);
	}

	protected listenFurther(peer: PeerNode, timeoutCounter: number = 0): boolean {
		if (timeoutCounter === 0) return true; //everyone gets a first listen. If it is already confirmed validating, we can still use it to request unknown quorumSets from.
		if (timeoutCounter >= 20) return false; //we wait for 100 seconds max if node is trying to reach consensus.
		if (peer.isValidatingIncorrectValues) return false;
		if (!peer.participatingInSCP) return false; //watcher node
		if (peer.isValidating && peer.quorumSet)
			//todo: a peer that is validating but doesnt have it's own quorumSet, could keep listening until max.
			return false; //we have all the needed information

		return true;
	}

	protected listen(
		peer: PeerNode,
		connection: Connection,
		timeoutCounter: number = 0,
		crawlState: CrawlState
	) {
		if (!this.listenFurther(peer, timeoutCounter)) {
			this.logger.debug(
				{
					pk: peer.publicKey,
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
				pk: peer.publicKey,
				latestActiveSlotIndex: peer.latestActiveSlotIndex
			},
			'Listening for externalize msg'
		);
		crawlState.listenTimeouts.set(
			peer.publicKey,
			setTimeout(() => {
				this.logger.debug({ pk: peer.publicKey }, 'SCP Listen timeout reached');
				timeoutCounter++;
				this.listen(peer, connection, timeoutCounter, crawlState);
			}, Crawler.SCP_LISTEN_TIMEOUT)
		);
	}

	protected wrapUp(
		resolve: (value: CrawlResult | PromiseLike<CrawlResult>) => void,
		crawlState: CrawlState
	) {
		this.logger.info('processed all items in queue');
		this.logger.info('Finished with all nodes');
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

		resolve({
			peers: crawlState.peerNodes,
			closedLedgers: crawlState.slots.getClosedSlotIndexes(),
			latestClosedLedger: crawlState.latestClosedLedger
		});
	}
}
