import {QuorumSet} from '@stellarbeat/js-stellar-domain';
import {AsyncResultCallback, queue, QueueObject} from 'async';

import {
    Connection,
    Node as NetworkNode,
    getConfigFromEnv,
    getPublicKeyStringFromBuffer,
    getIpFromPeerAddress,
    verifySCPEnvelopeSignature, getQuorumSetFromMessage,
} from "@stellarbeat/js-stellar-node-connector";

import {hash, Networks, xdr} from "stellar-base";
import LRUCache = require("lru-cache");
import StellarMessage = xdr.StellarMessage;
import MessageType = xdr.MessageType;
import ScpStatement = xdr.ScpStatement;
import ScpStatementType = xdr.ScpStatementType;
import {PeerNode} from "./peer-node";
import {NodeInfo} from "@stellarbeat/js-stellar-node-connector/lib/node";
import * as P from "pino";
import {Slots} from "./slots";

type PublicKey = string;
export type NodeAddress = [ip: string, port: number];

function nodeAddressToPeerKey(nodeAddress: NodeAddress) {
    return nodeAddress[0] + ':' + nodeAddress[1];
}

type PeerKey = string;//ip:port

require('dotenv').config();

type QuorumSetHash = string;

export interface Ledger {
    sequence: bigint;
    closeTime: Date;
}

export class Crawler {
    protected crawledNodeAddresses: Set<PeerKey>;
    protected openConnections: Map<PublicKey, Connection>;
    protected quorumSetOwners: Map<QuorumSetHash, Set<PublicKey>> = new Map();
    protected quorumSetMap: Map<QuorumSetHash, QuorumSet> = new Map<QuorumSetHash, QuorumSet>();
    protected quorumSetRequestedTo: Map<QuorumSetHash, Set<PublicKey>> = new Map();
    protected quorumSetRequests: Map<PublicKey, {
        timeout: NodeJS.Timeout,
        hash: QuorumSetHash
    }> = new Map();
    protected quorumSetRequestHashesInProgress: Set<QuorumSetHash> = new Set();
    protected crawlerNode: NetworkNode;
    protected logger: P.Logger;
    protected latestClosedLedger: Ledger = {
        sequence: BigInt(0),
        closeTime: new Date(0)
    };
    protected crawlQueue: QueueObject<NodeAddress>;
    protected peerNodes: Map<PublicKey, PeerNode> = new Map();
    protected listenTimeouts: Map<string, any> = new Map();
    protected envelopeCache = new LRUCache(5000);
    protected slots: Slots;

    protected static readonly MAX_LEDGER_DRIFT = 5; //how many ledgers can a node fall behind
    protected static readonly SCP_LISTEN_TIMEOUT = 5; //how long do we listen to determine if a node is participating in SCP. Correlated with Herder::EXP_LEDGER_TIMESPAN_SECONDS
    protected static readonly MAX_CLOSED_LEDGER_PROCESSING_TIME = 90000; //how long in ms we still process messages of closed ledgers.

    //todo: network string instead of boolean
    /**
     * @param topTierQuorumSet QuorumSet of top tier nodes that the crawler should trust to close ledgers and determine the correct externalized value.
     * Top tier nodes are trusted by everyone transitively, otherwise there would be no quorum intersection. Stellar core forwards scp messages of every transitively trusted node. Thus we can close ledgers when connecting to any node.
     * @param usePublicNetwork
     * @param maxOpenConnections How many connections can be open at the same time. The higher the number, the faster the crawl
     * @param quorumSetMap Known quorumSets to speed up crawling // todo move to crawl method?
     * @param logger
     */
    constructor(topTierQuorumSet: QuorumSet, usePublicNetwork: boolean = true, maxOpenConnections: number = 40, quorumSetMap: Map<string, QuorumSet> = new Map<string, QuorumSet>(), logger: any = null) {//todo networkId
        if (!process.env.HORIZON_URL) {
            throw new Error('Horizon not configured');
        }
        this.quorumSetMap = quorumSetMap;
        this.crawledNodeAddresses = new Set();
        this.openConnections = new Map(); //nodes that completed a handshake and we are currently listening to
        if (!logger) {
            logger = this.initializeDefaultLogger();
        }

        this.logger = logger.child({mod: 'Crawler'});
        this.slots = new Slots(topTierQuorumSet);

        this.crawlerNode = new NetworkNode(
            usePublicNetwork,
            getConfigFromEnv(), //todo: inject crawler config (or maybe crawlerNode itself?);
            logger
        );

        this.crawlQueue = queue(this.processCrawlPeerNodeInCrawlQueue.bind(this), maxOpenConnections);
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
    async crawl(nodeAddresses: NodeAddress[], latestClosedLedger: Ledger = {
        sequence: BigInt(0),
        closeTime: new Date(0)
    }): Promise<Array<PeerNode>> {
        console.time("crawl");
        this.latestClosedLedger = latestClosedLedger;
        this.logger.info("Starting crawl with seed of " + nodeAddresses.length + "addresses.");

        return await new Promise<Array<PeerNode>>(async (resolve) => {
                this.crawlQueue.drain(() => {
                    this.wrapUp(resolve);
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
        switch (stellarMessage.switch()) {
            case MessageType.scpMessage():
                this.onSCPEnvelopeReceived(connection, stellarMessage.envelope());
                break;
            case MessageType.peers():
                this.onPeersReceived(
                    connection, stellarMessage.peers());
                break;
            case MessageType.scpQuorumset():
                this.onQuorumSetReceived(connection, stellarMessage.qSet());
                break;
            case MessageType.dontHave():
                this.logger.info({
                    pk: connection.remotePublicKey,
                    type: stellarMessage.dontHave().type().name
                }, "Don't have");
                if (stellarMessage.dontHave().type().value === xdr.MessageType.getScpQuorumset().value) {
                    let hash = this.clearRequestQuorumSet(connection.remotePublicKey!);
                    if (hash) {
                        this.logger.info({pk: connection.remotePublicKey, hash: hash}, "Don't have");
                        this.requestQuorumSet(hash);
                    }
                }
                break;
            case MessageType.errorMsg():
                this.onStellarMessageErrorReceived(connection, stellarMessage.error());
        }
    }

    protected onStellarMessageErrorReceived(connection: Connection, errorMessage: xdr.Error) {
        switch (errorMessage.code()) {
            case xdr.ErrorCode.errLoad():
                this.onLoadTooHighReceived(connection);
                break;
            default:
                this.logger.info({
                    'pk': connection.remotePublicKey,
                    'peer': connection.remoteIp + ":" + connection.remotePort,
                    'error': errorMessage.code().name
                }, errorMessage.msg().toString());
                break;
        }

        connection.destroy(new Error(errorMessage.msg().toString()));
    }

    protected clearRequestQuorumSet(publicKey: PublicKey) {
        let quorumSetRequest = this.quorumSetRequests.get(publicKey);
        if (!quorumSetRequest)
            return;
        clearTimeout(quorumSetRequest.timeout);
        this.quorumSetRequests.delete(publicKey);
        this.quorumSetRequestHashesInProgress.delete(quorumSetRequest.hash);

        return quorumSetRequest.hash;
    }

    protected wrapUp(resolve: any) {
        this.logger.info("processed all items in queue");
        this.logger.info("Finished with all nodes");
        this.logger.info("Connection attempts: " + this.crawledNodeAddresses.size);
        this.logger.info("Detected public keys: " + this.peerNodes.size);
        this.logger.info("Successful connections: " + Array.from(this.peerNodes.values()).filter(peer => peer.successfullyConnected).length)
        this.logger.info('Validating nodes: ' + Array.from(this.peerNodes.values()).filter(node => node.isValidating).length);
        this.logger.info('Overloaded nodes: ' + Array.from(this.peerNodes.values()).filter(node => node.overLoaded).length);
        this.logger.info('Closed ledgers: ' + this.slots.getClosedSlotIndexes().length);
        this.logger.info(Array.from(this.peerNodes.values()).filter(node => node.suppliedPeerList).length + " supplied us with a peers list.");

        console.timeEnd("crawl")
        let peers: PeerNode[] = Array.from(this.peerNodes.values());
        resolve(
            peers
        );

    }

    protected requestQuorumSet(quorumSetHash: string) {
        if (this.quorumSetMap.has(quorumSetHash))
            return;

        if (this.quorumSetRequestHashesInProgress.has(quorumSetHash)) {
            this.logger.debug({hash: quorumSetHash}, 'Request already in progress');
            return;
        }

        this.logger.debug({hash: quorumSetHash}, 'Requesting quorumSet');
        let alreadyRequestedTo = this.quorumSetRequestedTo.get(quorumSetHash);
        if (!alreadyRequestedTo) {
            alreadyRequestedTo = new Set();
            this.quorumSetRequestedTo.set(quorumSetHash, alreadyRequestedTo);
        }

        let owners = this.getQuorumSetHashOwners(quorumSetHash);
        let quorumSetMessage = StellarMessage.getScpQuorumset(Buffer.from(quorumSetHash, 'base64'));

        let sendRequest = (to: PublicKey) => {
            let connection = this.openConnections.get(to);
            if (!connection)
                return;
            alreadyRequestedTo!.add(connection.remotePublicKey!);
            this.quorumSetRequestHashesInProgress.add(quorumSetHash);
            this.logger.info({hash: quorumSetHash}, 'Requesting quorumSet from ' + to);

            connection.sendStellarMessage(quorumSetMessage);
            this.quorumSetRequests.set(to, {
                'timeout': setTimeout(() => {
                    this.logger.info({pk: to, hash: quorumSetHash}, 'Request timeout reached');
                    this.quorumSetRequests.delete(to);
                    this.quorumSetRequestHashesInProgress.delete(quorumSetHash);
                    this.requestQuorumSet(quorumSetHash);
                }, 2000), hash: quorumSetHash
            });
        }

        //first try the owners of the hashes
        let notYetRequestedOwnerWithActiveConnection =
            Array.from(owners.keys())
                .filter(owner => !alreadyRequestedTo!.has(owner))
                .find(owner => this.openConnections.has(owner));
        if (notYetRequestedOwnerWithActiveConnection) {
            sendRequest(notYetRequestedOwnerWithActiveConnection);
            return;
        }

        //try other open connections
        let notYetRequestedNonOwnerActiveConnection =
            Array.from(this.openConnections.keys())
                //.filter(publicKey => this.getPeer(publicKey)!.participatingInSCP)
                .find(publicKey => !alreadyRequestedTo!.has(publicKey));

        if (notYetRequestedNonOwnerActiveConnection) {
            sendRequest(notYetRequestedNonOwnerActiveConnection);
            return;
        }

        this.logger.warn({hash: quorumSetHash}, 'No active connections to request quorumSet from');
    }

    /*
    * CONNECTION EVENT LISTENERS
     */
    protected onNodeDisconnected(connection: Connection, done: AsyncResultCallback<any>) {
        try {
            this.logger.info({'pk': connection.remotePublicKey, 'peer': connection.remoteAddress}, 'Node disconnected');
            if (this.listenTimeouts.get(connection.remoteAddress))
                clearTimeout(this.listenTimeouts.get(connection.remoteAddress));

            this.openConnections.delete(connection.remotePublicKey!);

            let hash = this.clearRequestQuorumSet(connection.remotePublicKey!);
            if (hash)
                this.requestQuorumSet(hash);
            this.logger.debug("nodes left in queue: " + this.crawlQueue.length());
            done();//done processing
        } catch (error) {
            this.logger.error({'peer': connection.remoteAddress}, 'Exception: ' + error.message);
            done(error)
        }
    }

    protected disconnect(connection: Connection, error?: Error) {
        this.openConnections.delete(connection.remotePublicKey!);//we don't want to send any more commands
        connection.destroy(error);
    }

    protected onConnected(connection: Connection, publicKey: PublicKey, nodeInfo: NodeInfo) {
        try {
            this.logger.info({'peer': connection.remoteAddress, 'pk': publicKey}, 'Connected');

            let peerNode = this.peerNodes.get(publicKey);
            if (peerNode && peerNode.successfullyConnected) {//this public key is already used in this crawl! A node is not allowed to reuse public keys. Disconnecting.
                this.logger.error({
                    'peer': connection.remoteAddress,
                    'pk': publicKey
                }, 'PeerNode reusing publickey on address ' + this.peerNodes.get(publicKey)!.key);
                connection.destroy();
                return; //we don't return this peernode to consumer of this library
            }

            if (!peerNode) {
                peerNode = new PeerNode(
                    publicKey
                );
            }

            peerNode.nodeInfo = nodeInfo;
            peerNode.ip = connection.remoteIp;
            peerNode.port = connection.remotePort;

            this.peerNodes.set(publicKey, peerNode);

            if (peerNode.quorumSetHash && !peerNode.quorumSet) {
                this.logger.info({'hash': peerNode.quorumSetHash, 'pk': peerNode.publicKey}, 'Priority request');
                this.quorumSetRequestHashesInProgress.delete(peerNode.quorumSetHash);
                let runningQuorumSetRequest = this.quorumSetRequests.get(peerNode.publicKey);
                if (runningQuorumSetRequest) {
                    clearTimeout(runningQuorumSetRequest.timeout);
                    this.quorumSetRequests.delete(peerNode.publicKey);
                }
                this.requestQuorumSet(peerNode.quorumSetHash);
            }
            /*if (!this._nodesThatSuppliedPeerList.has(connection.peer)) { //Most nodes send their peers automatically on successful handshake, better handled with timer.

                this._connectionManager.sendGetPeers(connection);
            }*/

            this.listen(peerNode, connection);
        } catch (error) {
            this.logger.error({'peer': connection.remoteAddress}, error.message);
        }
    }

    protected onPeersReceived(connection: Connection, peers: xdr.PeerAddress[]) {
        let peerAddresses: Array<NodeAddress> = [];
        peers.forEach(peer => {
            let ipResult = getIpFromPeerAddress(peer);
            if (ipResult.isOk())
                peerAddresses.push([ipResult.value, peer.port()])
        })

        this.logger.debug({'peer': connection.remoteAddress}, peerAddresses.length + ' peers received');
        let peer = this.peerNodes.get(connection.remotePublicKey!)!;
        peer.suppliedPeerList = true;
        peerAddresses.forEach(peerAddress => this.crawlPeerNode(peerAddress));
    }

    protected onLoadTooHighReceived(connection: Connection) {
        try {
            this.logger.info({'peer': connection.remoteAddress}, 'Load too high message received');
            if (connection.remotePublicKey) {
                let node = this.peerNodes.get(connection.remotePublicKey);
                if (node) {
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

        let slotIndex = BigInt(scpEnvelope.statement().slotIndex().toString());
        let latestSequenceDifference = Number(this.latestClosedLedger.sequence - slotIndex);

        if (latestSequenceDifference > Crawler.MAX_LEDGER_DRIFT)
            return; //ledger message older than allowed by pure ledger sequence numbers

        if (slotIndex <= this.latestClosedLedger.sequence && new Date().getTime() - this.latestClosedLedger.closeTime.getTime() > Crawler.MAX_CLOSED_LEDGER_PROCESSING_TIME){
            return; //we only allow for x seconds of processing of closed ledger messages
        }

        let verifiedResult = verifySCPEnvelopeSignature(scpEnvelope, hash(Buffer.from(Networks.PUBLIC)));
        if (verifiedResult.isOk() && verifiedResult.value)//todo: worker?
            this.onSCPStatementReceived(connection, scpEnvelope.statement())
        else
            connection.destroy(new Error("Invalid SCP Signature")); //nodes should generate or forward invalid messages
    }

    protected getQuorumSetHash(scpStatement: ScpStatement) {
        let quorumSetHash: QuorumSetHash;
        switch (scpStatement.pledges().switch()) {
            case ScpStatementType.scpStExternalize():
                quorumSetHash = scpStatement.pledges().externalize().commitQuorumSetHash().toString('base64');
                break;
            case ScpStatementType.scpStConfirm():
                quorumSetHash = scpStatement.pledges().confirm().quorumSetHash().toString('base64');
                break;
            case ScpStatementType.scpStPrepare():
                quorumSetHash = scpStatement.pledges().prepare().quorumSetHash().toString('base64');
                break;
            case ScpStatementType.scpStNominate():
                quorumSetHash = scpStatement.pledges().nominate().quorumSetHash().toString('base64');
                break;
        }

        return quorumSetHash!;
    }

    protected getQuorumSetHashOwners(quorumSetHash: QuorumSetHash) {
        let quorumSetHashOwners = this.quorumSetOwners.get(quorumSetHash);
        if (!quorumSetHashOwners) {
            quorumSetHashOwners = new Set();
            this.quorumSetOwners.set(quorumSetHash, quorumSetHashOwners);
        }

        return quorumSetHashOwners;
    }

    protected onSCPStatementReceived(connection: Connection, scpStatement: ScpStatement) {
        let publicKeyResult = getPublicKeyStringFromBuffer(scpStatement.nodeId().value()); //todo: compare with buffers for (slight) perf improvement?
        if (publicKeyResult.isErr()) {
            connection.destroy(publicKeyResult.error)
            return;
        }

        let publicKey = publicKeyResult.value;

        this.logger.debug({
            'peer': connection.remoteAddress,
            'publicKey': publicKey,
            'slotIndex': scpStatement.slotIndex().toString()
        }, 'processing new scp statement: ' + scpStatement.pledges().switch().name);

        let peer = this.peerNodes.get(publicKey);
        if (!peer) {
            peer = new PeerNode(publicKey);
            this.peerNodes.set(publicKey, peer);
        }

        peer.latestActiveSlotIndex = scpStatement.slotIndex().toString();
        peer.quorumSetHash = this.getQuorumSetHash(scpStatement);

        if (!this.getQuorumSetHashOwners(peer.quorumSetHash).has(publicKey)) {
            this.logger.info({'pk': publicKey, hash: peer.quorumSetHash}, 'Detected quorumSetHash');
        }

        this.getQuorumSetHashOwners(peer.quorumSetHash).add(publicKey);

        if (this.quorumSetMap.has(peer.quorumSetHash))
            peer.quorumSet = this.quorumSetMap.get(peer.quorumSetHash);
        else {
            this.logger.debug({'pk': publicKey}, 'Unknown quorumSet for hash: ' + peer.quorumSetHash);
            this.requestQuorumSet(peer.quorumSetHash);
        }

        if (scpStatement.pledges().switch().value !== ScpStatementType.scpStExternalize().value) { //only if node is externalizing, we mark the node as validating
            return;
        }

        this.processExternalizeStatement(peer, BigInt(scpStatement.slotIndex().toString()), scpStatement.pledges().externalize())
    }

    protected processExternalizeStatement(peer: PeerNode, slotIndex: bigint, statementExternalize: xdr.ScpStatementExternalize) {
        let value = statementExternalize.commit().value().toString('base64');
        this.logger.debug({
            'publicKey': peer.publicKey,
            'slotIndex': slotIndex
        }, 'externalize msg with value: ' + value);

        let markNodeAsValidating = (peer: PeerNode) => {
            if (!peer.isValidating) {
                this.logger.info({
                    'pk': peer.publicKey,
                }, 'Validating');
            }
            peer.isValidating = true;
        }

        let slot = this.slots.getSlot(slotIndex);
        let slotWasClosedBefore = slot.closed();
        //TODO: maybe not try to close older SLOTS
        slot.addExternalizeValue(peer.publicKey, value);

        if (slot.closed()) {
            if (!slotWasClosedBefore) {//we just closed the slot, lets mark all nodes as validating!
                this.logger.info({ledger: slotIndex.toString()}, 'Ledger closed!');
                this.latestClosedLedger = {
                    sequence: slotIndex,
                    closeTime: new Date()
                }
                slot.getNodesAgreeingOnExternalizedValue().forEach(validatingPublicKey => {
                    let validatingPeer = this.peerNodes.get(validatingPublicKey);
                    if (validatingPeer)
                        markNodeAsValidating(validatingPeer);
                });
            } else { //if the slot was already closed, we check if this new (?) node should be marked as validating
                if (value === slot.externalizedValue)
                    markNodeAsValidating(peer);
            }
        }
    }

    protected onQuorumSetReceived(connection: Connection, quorumSetMessage: xdr.ScpQuorumSet) {
        let quorumSetResult = getQuorumSetFromMessage(quorumSetMessage);
        if (quorumSetResult.isErr()) {
            connection.destroy(quorumSetResult.error);
            return;
        }
        let quorumSet = quorumSetResult.value;
        this.logger.info({'pk': connection.remotePublicKey, 'hash': quorumSet.hashKey!}, 'QuorumSet received');
        this.quorumSetMap.set(quorumSet.hashKey!, quorumSet);
        let owners = this.getQuorumSetHashOwners(quorumSet.hashKey!);

        owners.forEach(owner => {
            let peer = this.peerNodes.get(owner);
            if (peer)
                peer.quorumSet = quorumSet;
        });
        this.clearRequestQuorumSet(connection.remotePublicKey!);
    }

    protected listenFurther(peer: PeerNode, timeoutCounter: number = 0): boolean {
        if (timeoutCounter === 0)
            return true;//everyone gets a first listen. If it is already confirmed validating, we can still use it to request unknown quorumSets from.
        if (timeoutCounter >= 20)
            return false;//we wait for 100 seconds max if node is trying to reach consensus.
        if (!peer.participatingInSCP)
            return false;//watcher node
        if (peer.isValidating && peer.quorumSet)
            return false;//we have all the needed information

        return true;
    }

    protected listen(peer: PeerNode, connection: Connection, timeoutCounter: number = 0) {
        if (!this.listenFurther(peer, timeoutCounter)) {
            this.logger.debug({
                'pk': peer.publicKey,
                'counter': timeoutCounter,
                'validating': peer.isValidating,
                'scp': peer.participatingInSCP
            }, 'Disconnect'); //todo: if externalizing wrong values, we should disconnect, but not here, in receivedSCPMSG
            this.disconnect(connection);
            return;
        }
        this.logger.debug({
            'pk': peer.publicKey,
            'latestActiveSlotIndex': peer.latestActiveSlotIndex
        }, 'Listening for externalize msg'); //todo: if externalizing wrong values, we should disconnect.
        this.openConnections.set(peer.publicKey, connection);

        this.listenTimeouts.set(peer.publicKey, setTimeout(() => {
            this.logger.debug({'pk': peer.publicKey}, 'SCP Listen timeout reached');
            timeoutCounter++;
            this.listen(peer, connection, timeoutCounter);
        }, 5000)); //5 seconds for first scp message,
    }
}