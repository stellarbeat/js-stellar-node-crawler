import {QuorumSet} from '@stellarbeat/js-stellar-domain';
import {AsyncResultCallback, queue, QueueObject} from 'async';

import {
    Connection,
    Node as NetworkNode,
    getConfigFromEnv,
    getPublicKeyStringFromBuffer,
    getIpFromPeerAddress,
    verifySCPEnvelopeSignature,
} from "@stellarbeat/js-stellar-node-connector";

import {hash, Networks, xdr} from "stellar-base";
import LRUCache = require("lru-cache");
import StellarMessage = xdr.StellarMessage;
import MessageType = xdr.MessageType;
import ScpStatement = xdr.ScpStatement;
import ScpStatementType = xdr.ScpStatementType;
import {Peer, PeerNode, UnknownPeerNode} from "./peer-node";
import {NodeInfo} from "@stellarbeat/js-stellar-node-connector/lib/node";
import * as P from "pino";
import {Slots} from "./slots";

type PublicKey = string;
export type NodeAddress = [ip: string, port: number];

function nodeAddressToPeerKey(nodeAddress: NodeAddress) {
    return nodeAddress[0] + ':' + nodeAddress[1];
}

type PeerKey = string;//ip:port
type LedgerSequence = number;

require('dotenv').config();

type QuorumSetHash = string;

export class Crawler {
    protected crawledNodeAddresses: Set<PeerKey>;
    protected activeConnections: Map<PublicKey, Connection>;
    protected quorumSetOwners: Map<string, Set<string>>;
    protected quorumSetMap: Map<QuorumSetHash, QuorumSet> = new Map<QuorumSetHash, QuorumSet>();
    protected crawlerNode: NetworkNode;
    protected logger: P.Logger;
    protected latestLedgerSequence: LedgerSequence = 0;
    protected crawlQueue: QueueObject<NodeAddress>;
    protected quorumSetDiscoveryQueues: Map<QuorumSetHash, QueueObject<any>> = new Map();
    protected peerNodesByPublicKey: Map<PublicKey, PeerNode> = new Map();
    protected unknownPeerNodesByPublicKey: Map<PublicKey, UnknownPeerNode> = new Map();
    protected timeouts: Map<string, any> = new Map();
    protected envelopeCache = new LRUCache(5000);
    protected slots: Slots;
    protected networkId: string = 'todo';
    protected validatingPublicKeys: Set<PublicKey> = new Set();
    protected scpTimeoutCounters: Map<PublicKey, number> = new Map();

    //todo: network string instead of boolean
    /**
     *
     * @param quorumSet Trusted nodes to determine closed ledgers
     * @param usePublicNetwork
     * @param concurrency Amount of nodes crawled concurrently
     * @param quorumSetMap Known quorumSets to speed up crawling
     * @param logger
     */
    constructor(quorumSet: QuorumSet, usePublicNetwork: boolean = true, concurrency: number = 400, quorumSetMap: Map<string, QuorumSet> = new Map<string, QuorumSet>(), logger: any = null) {//todo networkId
        if (!process.env.HORIZON_URL) {
            throw new Error('Horizon not configured');
        }
        this.quorumSetMap = quorumSetMap;
        this.crawledNodeAddresses = new Set();
        this.activeConnections = new Map(); //nodes that completed a handshake and we are currently listening to
        this.quorumSetOwners = new Map();
        if (!logger) {
            logger = this.initializeDefaultLogger();
        }

        this.logger = logger.child({mod: 'Crawler'});
        this.slots = new Slots(quorumSet);

        this.crawlerNode = new NetworkNode(
            usePublicNetwork,
            getConfigFromEnv(), //todo: inject crawler config (or maybe crawlerNode itself?);
            logger
        );

        this.crawlQueue = queue(this.processCrawlPeerNodeInCrawlQueue.bind(this), concurrency);
    }

    public getProcessedLedgers() {
        return this.slots.getClosedSlotIndexes();
    }

    protected initializeDefaultLogger() {
        return P({
            level: process.env.LOG_LEVEL || 'info',
            base: undefined,
        });
    }

    //todo add 'crawl' object, that holds necessary data structures for the 'current' crawl. this object is passed to every connection event handler.
    async crawl(nodeAddresses: NodeAddress[], latestLedgerSequence: number = 0): Promise<Array<PeerNode>> {
        console.time("crawl");
        this.latestLedgerSequence = latestLedgerSequence;
        this.logger.info("Starting crawl with seed of " + nodeAddresses.length + "addresses.");

        return await new Promise<Array<PeerNode>>(async (resolve, reject) => {
                this.crawlQueue.drain(() => {
                    this.wrapUp(resolve, reject);
                });//when queue is empty, we wrap up the crawl
                nodeAddresses.forEach(address => this.crawlPeerNode(address));
            }
        );
    }

    protected crawlPeerNode(nodeAddress: NodeAddress) {
        let peerKey = nodeAddressToPeerKey(nodeAddress);
        if (this.crawledNodeAddresses.has(peerKey)) {
            this.logger.debug({'peer': peerKey}, 'Address already crawled');
            return;
        }

        this.logger.debug({'peer': peerKey}, 'Adding address to crawl queue');
        this.crawledNodeAddresses.add(peerKey);
        this.crawlQueue.push([nodeAddress], (error) => {
            if (error)
                this.logger.error({peer: peerKey}, error.message);
        });
    }

    protected processCrawlPeerNodeInCrawlQueue(address: NodeAddress, done: AsyncResultCallback<any>) {
        try {
            let connection = this.crawlerNode.connectTo(
                address[0],
                address[1]
            );
            this.logger.info({'peer': connection.remoteAddress}, 'Connecting');

            connection
                .on("error", (error: Error) => this.logger.debug({peer: connection.remoteAddress}, 'error: ' + error.message))
                .on("connect", (publicKey: string, nodeInfo: NodeInfo) => this.onConnected(connection, publicKey, nodeInfo))
                .on("data", (stellarMessage: StellarMessage) => this.onStellarMessage(connection, stellarMessage))
                .on('timeout', () => this.onTimeout(connection))
                .on("close", () => this.onNodeDisconnected(connection, done))
        } catch (error) {
            this.logger.error({'peer': address[0] + ':' + address[1]}, error.message);
        }
    }

    protected onTimeout(connection: Connection) {
        this.logger.debug({peer: connection.remoteAddress}, 'Connection timeout');
        connection.destroy();
    }

    protected onStellarMessage(connection: Connection, stellarMessage: StellarMessage) {
        if (stellarMessage.switch().value === MessageType.scpMessage().value) {
            this.onSCPEnvelopeReceived(connection, stellarMessage.envelope())
        }
        if (stellarMessage.switch().value === MessageType.peers().value)
            this.onPeersReceived(
                stellarMessage.peers().map(peer => {
                    return [getIpFromPeerAddress(peer), peer.port()];
                }), connection);
    }

    protected wrapUp(resolve: any, reject: any) {
        this.logger.info("processed all items in queue");
        this.logger.info("Finished with all nodes");
        this.logger.info(this.crawledNodeAddresses.size + " nodes crawled of which are active: " + Array.from(this.peerNodesByPublicKey.values()).filter(node => node.active).length);
        this.logger.info('of which are validating: ' + Array.from(this.peerNodesByPublicKey.values()).filter(node => node.isValidating).length);
        this.logger.info('Found validating but could not connect to: ' + Array.from(this.validatingPublicKeys).filter(publicKey => !this.peerNodesByPublicKey.has(publicKey)));
        this.logger.info('of which are overloaded: ' + Array.from(this.peerNodesByPublicKey.values()).filter(node => node.overLoaded).length);
        this.logger.info(Array.from(this.peerNodesByPublicKey.values()).filter(node => node.suppliedPeerList).length + " supplied us with a peers list.");
        console.timeEnd("crawl")

        resolve(
            Array.from(this.peerNodesByPublicKey.values())
        );

    }

    protected requestQuorumSetFromConnectedNodes(quorumSetHash: string, quorumSetOwnerPublicKey: string) {
        let isSent = false;
        //send to owner
        this.activeConnections.forEach(connection => {
                if (connection.remotePublicKey === quorumSetOwnerPublicKey) {
                    //connection.sendStellarMessage(StellarMessage.getScpQuorumset(Buffer.from(quorumSetHash, 'base64')));
                    isSent = true;
                }
            }
        );

        if (isSent) {
            return;
        }

        //if we are not connected to the owner, send a request to everyone
        this.activeConnections.forEach(connection => {
                //connection.sendStellarMessage(StellarMessage.getScpQuorumset(Buffer.from(quorumSetHash, 'base64')));
            }
        );
    }

    /*
    * CONNECTION EVENT LISTENERS
     */
    protected onNodeDisconnected(connection: Connection, done: AsyncResultCallback<any>) {
        try {
            this.logger.debug({'peer': connection.remoteAddress}, 'Node disconnected');
            if (this.timeouts.get(connection.remoteAddress))
                clearTimeout(this.timeouts.get(connection.remoteAddress));

            if (this.activeConnections.has(connection.remotePublicKey!)) {
                this.activeConnections.delete(connection.remotePublicKey!);
            }
            this.logger.debug("nodes left in queue: " + this.crawlQueue.length());
            done();//done processing
        } catch (error) {
            this.logger.error({'peer': connection.remoteAddress}, 'Exception: ' + error.message);
            done(error)
        }
    }

    protected onConnected(connection: Connection, publicKey: PublicKey, nodeInfo: NodeInfo) {
        try {
            this.logger.info({'peer': connection.remoteAddress, 'pk': publicKey}, 'Connected');

            let peerNode = new PeerNode(
                connection.remoteIp,
                connection.remotePort,
                publicKey,
                nodeInfo.ledgerVersion,
                nodeInfo.overlayVersion,
                nodeInfo.overlayMinVersion,
                nodeInfo.networkId ? nodeInfo.networkId : this.networkId,
                nodeInfo.versionString
            );

            peerNode.active = true;

            let unknownPeerNodeMatch = this.unknownPeerNodesByPublicKey.get(publicKey);
            if(unknownPeerNodeMatch){
                peerNode.participatingInSCP = unknownPeerNodeMatch.participatingInSCP;
                peerNode.isValidating = unknownPeerNodeMatch.isValidating;
                peerNode.quorumSet = unknownPeerNodeMatch.quorumSet;
                peerNode.quorumSetHash = unknownPeerNodeMatch.quorumSetHash;
                this.unknownPeerNodesByPublicKey.delete(publicKey);//peerNode no longer unknown
            }

            if (this.peerNodesByPublicKey.has(publicKey)) {//this public key is already used in this crawl! A node is not allowed to reuse public keys. Disconnecting.
                this.logger.error({
                    'peer': connection.remoteAddress,
                    'pk': publicKey
                }, 'Peernode reusing publickey on address ' + this.peerNodesByPublicKey.get(publicKey)!.key);
                connection.destroy();
                return; //we don't return this peernode to consumer of this library
            }

            this.peerNodesByPublicKey.set(publicKey, peerNode);
            this.activeConnections.set(publicKey, connection);
            /*if (!this._nodesThatSuppliedPeerList.has(connection.peer)) { //Most nodes send their peers automatically on successful handshake
                this._connectionManager.sendGetPeers(connection);
            }*/
            if (this.validatingPublicKeys.has(publicKey)) { //we already confirmed that the node is validating by listening to externalize messages propagated by other nodes.
                //TODO: validating AND we have quorumSet
                this.logger.debug({'peer': connection.remoteAddress}, ': ' + connection.remotePublicKey + ' already confirmed validating, disconnecting');
                peerNode.isValidating = true;
                connection.destroy();
            } else {
                this.setSCPTimeout(peerNode);
                this.logger.debug({'peer': connection.remoteAddress}, ': send get scp status message');
                //connection.sendStellarMessage(StellarMessage.getScpState(0));//a peernode can ignore this message when it has a high load.
                //this._connectionManager.sendGetScpStatus(connection, this._ledgerSequence)
            }
        } catch (error) {
            this.logger.error({'peer': connection.remoteAddress}, error.message);
        }
    }

    protected onPeersReceived(peerAddresses: Array<NodeAddress>, connection: Connection) {
        try {
            this.logger.debug({'peer': connection.remoteAddress}, peerAddresses.length + ' peers received');
            let peer = this.peerNodesByPublicKey.get(connection.remotePublicKey!)!;
            peer.suppliedPeerList = true;
            peerAddresses.forEach(peerAddress => {
                let peerKey = nodeAddressToPeerKey(peerAddress)
                if (!this.crawledNodeAddresses.has(peerKey)) { //newly discovered peer
                    this.logger.debug({'peer': connection.remoteAddress}, 'supplied a newly discovered peer: ' + peerKey);
                    this.crawlPeerNode(peerAddress);
                } else {
                    this.logger.debug('peer ' + peerKey + ' already crawled');
                }
            });
        } catch (error) {
            this.logger.error({'peer': connection.remoteAddress}, error.message);
        }

    }

    protected onLoadTooHighReceived(connection: Connection) {
        try {
            this.logger.info({'peer': connection.remoteAddress}, 'Load too high message received');
            if (connection.remotePublicKey) {
                let node = this.peerNodesByPublicKey.get(connection.remotePublicKey);
                if (node) {
                    node.active = true;
                    node.overLoaded = true;
                }
            }
        } catch (error) {
            this.logger.error({'peer': connection.remoteAddress}, error.message);
        }
    }

    protected onSCPEnvelopeReceived(connection: Connection, scpEnvelope: xdr.ScpEnvelope) {
        if (this.envelopeCache.has(scpEnvelope.signature().toString())) {
            return;
        }
        this.envelopeCache.set(scpEnvelope.signature().toString(), 1);
        //@ts-ignore
        if (verifySCPEnvelopeSignature(scpEnvelope, hash(Networks.PUBLIC)))//todo: worker ?
            this.onSCPStatementReceived(connection, scpEnvelope.statement())
        else
            connection.destroy(new Error("Invalid SCP Signature")); //nodes should not forward invalid messages
    }

    protected onSCPStatementReceived(connection: Connection, scpStatement: ScpStatement) {
        let publicKey = getPublicKeyStringFromBuffer(scpStatement.nodeId().value()); //todo: compare with buffers for (slight) perf improvement?

        if (Number(scpStatement.slotIndex) < this.latestLedgerSequence) {
            return; //older scp messages are ignored.
        }

        this.logger.debug({
            'peer': connection.remoteAddress,
            'publicKey': publicKey,
            'slotIndex': scpStatement.slotIndex().toString()
        }, 'processing new scp statement: ' + scpStatement.pledges().switch().name);

        let peer = this.getPeer(publicKey);
        if (!peer){
            peer = new UnknownPeerNode(publicKey);
            this.unknownPeerNodesByPublicKey.set(publicKey, peer);
        }

        peer.participatingInSCP = true;

        if (scpStatement.pledges().switch().value !== ScpStatementType.scpStExternalize().value) { //only if node is externalizing, we mark the node as validating
            return;
        }

        this.processExternalizeStatement(peer, scpStatement.slotIndex().toString(), scpStatement.pledges().externalize())


        /*let quorumSetHash = scpStatement.pledges().externalize().commitQuorumSetHash().toString('base64');
        let quorumSetOwnerPublicKey = publicKey;

        try {
            this.logger.debug({'peer': connection.remoteAddress}, 'Detected quorumSetHash: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);

            if (scpNode.quorumSet.hashKey === quorumSetHash) {
                this.logger.debug({'peer': connection.remoteAddress}, 'Quorumset already known to us for peer: ' + quorumSetOwnerPublicKey);
                //we don't need any more info for this node, fully processed
                this.processedValidatingNodes.add(publicKey); //node is confirmed validating and we have the quorumset. If we connect to it in the future, we can disconnect immediately and mark it as validating.//todo: disconnect if currently connected?
            } else {
                this.logger.debug({'peer': connection.remoteAddress}, 'Unknown or modified quorumSetHash for peer, requesting it: ' + quorumSetOwnerPublicKey + ' => ' + quorumSetHash);
                let owners = this.quorumSetOwners.get(quorumSetHash);
                if (owners) {
                    if (owners.has(quorumSetOwnerPublicKey)) {
                        this.logger.debug({'peer': connection.remoteAddress}, 'Already logged quorumSetHash for owner: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);
                    } else {
                        owners.add(quorumSetOwnerPublicKey);
                        this.logger.debug({'peer': connection.remoteAddress}, 'Logged new owner for quorumSetHash: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);
                    }
                } else {
                    this.quorumSetOwners.set(quorumSetHash, new Set([quorumSetOwnerPublicKey]));
                }
                this.logger.debug({'peer': connection.remoteAddress}, ': Requesting quorumset: ' + quorumSetHash);

                this.requestQuorumSetFromConnectedNodes(quorumSetHash, quorumSetOwnerPublicKey);
            }
        } catch (error) {
            this.logger.error({'peer': connection.remoteAddress}, error.message);
        }*/
    }

    protected processExternalizeStatement(peer: Peer, slotIndex: string, statementExternalize: xdr.ScpStatementExternalize) {
        let value = statementExternalize.commit().value().toString('base64');
        this.logger.debug({
            'publicKey': peer.publicKey,
            'slotIndex': slotIndex
        }, 'externalize msg with value: ' + value);

        let markNodeAsValidating = (peer: Peer) => {
            if (!this.validatingPublicKeys.has(peer.publicKey)) {
                this.logger.info({
                    'pk': peer.publicKey,
                }, 'Validating');
            }
            this.validatingPublicKeys.add(peer.publicKey);
            peer.isValidating = true;
        }

        let slot = this.slots.getSlot(slotIndex);
        let slotWasClosedBefore = slot.closed();
        slot.addExternalizeValue(peer.publicKey, value);

        if (slot.closed()) {
            if (!slotWasClosedBefore) {//we just closed the slot, lets mark all nodes as validating!
                this.logger.info({ledger: slotIndex}, 'Ledger closed!');
                slot.getNodesAgreeingOnExternalizedValue().forEach(validatingPublicKey => {
                    let validatingPeer = this.getPeer(validatingPublicKey);
                    if(validatingPeer)
                        markNodeAsValidating(validatingPeer);
                });
            } else { //if the slot was already closed, we check if this new (?) node should be marked as validating
                if (value === slot.externalizedValue)
                    markNodeAsValidating(peer);
            }
        }
    }

    getPeer(publicKey: PublicKey){
        let peer = this.peerNodesByPublicKey.get(publicKey);
        if(peer)
            return peer;

        return this.unknownPeerNodesByPublicKey.get(publicKey);
    }

    protected onQuorumSetReceived(connection: Connection, quorumSet: QuorumSet) {
        try {
            this.logger.debug({'peer': connection.remoteAddress}, 'QuorumSet received: ' + quorumSet.hashKey);
            if (!quorumSet.hashKey)
                throw new Error('Missing hashkey for quorumset');
            let owners = this.quorumSetOwners.get(quorumSet.hashKey);
            if (!owners) {
                return;
            }
            owners.forEach(owner => {
                let nodeWithNewQuorumSet = this.peerNodesByPublicKey.get(owner);
                if (nodeWithNewQuorumSet === undefined)
                    return;

                //@ts-ignore
                if (nodeWithNewQuorumSet.quorumSet.hashKey === quorumSet.hashKey) {
                    this.logger.debug('QuorumSet already updated for peer: ' + nodeWithNewQuorumSet.publicKey + ' => ' + quorumSet.hashKey);

                } else {
                    this.logger.debug('Updating QuorumSet for peer: ' + nodeWithNewQuorumSet.publicKey + ' => ' + quorumSet.hashKey);
                    nodeWithNewQuorumSet.quorumSet = quorumSet;
                }
            });
        } catch (error) {
            this.logger.error({'peer': connection.remoteAddress}, error.message);
        }
    }

    protected setSCPTimeout(peer: Peer) {
        this.scpTimeoutCounters.set(peer.publicKey, 0);

        this.timeouts.set(peer.publicKey, setTimeout(() => {
            this.logger.debug({'pk': peer.publicKey}, 'SCP Listen timeout reached');
            let timeoutCounter = this.scpTimeoutCounters.get(peer.publicKey)!;
            timeoutCounter++;
            if (peer.participatingInSCP && !peer.isValidating && timeoutCounter <= 20) {//we wait for 100 seconds max if node is trying to reach consensus.
                this.logger.info({'pk': peer.publicKey}, 'Node was active in SCP, but not yet confirmed validating. Adding more time to listen for externalize messages'); //todo: if externalizing wrong values, we should disconnect.
                this.setSCPTimeout(peer);
            } else { //if not participating in SCP or the node is confirmed validating, we disconnect: TODO: are we requesting quorumSet?
                this.logger.debug({
                    'pk': peer.publicKey,
                    'counter': timeoutCounter,
                    'validating': peer.isValidating,
                    'scp': peer.participatingInSCP
                }, 'Disconnect'); //todo: if externalizing wrong values, we should disconnect, but not here, in receivedSCPMSG
                let connection = this.activeConnections.get(peer.publicKey);
                if (connection)
                    connection.destroy();
            }
        }, 5000)); //5 seconds for first scp message, correlated with Herder::EXP_LEDGER_TIMESPAN_SECONDS
    }
}