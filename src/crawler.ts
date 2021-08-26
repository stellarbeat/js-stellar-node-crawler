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
    protected latestLedgerSequence: LedgerSequence = 0;
    protected crawlQueue: QueueObject<NodeAddress>;
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
    constructor(quorumSet: QuorumSet, usePublicNetwork: boolean = true, concurrency: number = 40, quorumSetMap: Map<string, QuorumSet> = new Map<string, QuorumSet>(), logger: any = null) {//todo networkId
        if (!process.env.HORIZON_URL) {
            throw new Error('Horizon not configured');
        }
        this.quorumSetMap = quorumSetMap;
        this.crawledNodeAddresses = new Set();
        this.activeConnections = new Map(); //nodes that completed a handshake and we are currently listening to
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
                this.logger.info({pk: connection.remotePublicKey, type: stellarMessage.dontHave().type().name}, "Don't have");
                if(stellarMessage.dontHave().type().value === xdr.MessageType.getScpQuorumset().value){
                   let hash = this.clearRequestQuorumSet(connection.remotePublicKey!);
                   if(hash){
                       this.logger.info({pk: connection.remotePublicKey, hash: hash}, "Don't have");
                       this.requestQuorumSetFromConnectedNodes(hash);
                   }
                }
                break;
            case MessageType.errorMsg():
                console.log(connection.remotePublicKey);
                console.log(stellarMessage.error().code().name);
                console.log(stellarMessage.error().msg().toString());
                connection.destroy(new Error(stellarMessage.error().msg().toString()));
        }
    }

    protected clearRequestQuorumSet(publicKey: PublicKey){
        let quorumSetRequest = this.quorumSetRequests.get(publicKey);
        if(!quorumSetRequest)
            return;
        clearTimeout(quorumSetRequest.timeout);
        this.quorumSetRequests.delete(publicKey);
        this.quorumSetRequestHashesInProgress.delete(quorumSetRequest.hash);

        return quorumSetRequest.hash;
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

    protected requestQuorumSetFromConnectedNodes(quorumSetHash: string) {
        if(this.quorumSetMap.has(quorumSetHash))
            return;

        if(this.quorumSetRequestHashesInProgress.has(quorumSetHash)) {
            this.logger.debug({hash: quorumSetHash}, 'Request already in progress');
            return;
        }

        this.logger.debug({hash: quorumSetHash}, 'Requesting quorumSet');
        let alreadyRequestedTo = this.quorumSetRequestedTo.get(quorumSetHash);
        if(!alreadyRequestedTo){
            alreadyRequestedTo = new Set();
            this.quorumSetRequestedTo.set(quorumSetHash, alreadyRequestedTo);
        }
        let owners = this.getQuorumSetHashOwners(quorumSetHash);
        let quorumSetMessage = StellarMessage.getScpQuorumset(Buffer.from(quorumSetHash, 'base64'));

        let request = (publicKey: PublicKey) => {
            let connection = this.activeConnections.get(publicKey);
            if(!connection)
                return;
            alreadyRequestedTo!.add(connection.remotePublicKey!);
            this.quorumSetRequestHashesInProgress.add(quorumSetHash);
            this.logger.info({hash: quorumSetHash}, 'Requesting quorumSet from ' + publicKey);

            connection.sendStellarMessage(quorumSetMessage);
            this.quorumSetRequests.set(publicKey, {
                'timeout': setTimeout(() => {
                    this.logger.info({pk: publicKey, hash: quorumSetHash}, 'Request timeout reached');
                    this.quorumSetRequests.delete(publicKey);
                    this.quorumSetRequestHashesInProgress.delete(quorumSetHash);
                    this.requestQuorumSetFromConnectedNodes(quorumSetHash);
                }, 2000), hash: quorumSetHash});
        }

        //first try the owners of the hashes
        let notYetRequestedOwnerWithActiveConnection =
            Array.from(owners.keys())
                .filter(owner => !alreadyRequestedTo!.has(owner))
                .find(owner => this.activeConnections.has(owner));
        if(notYetRequestedOwnerWithActiveConnection){
            request(notYetRequestedOwnerWithActiveConnection);
            return;
        }

        //try other active connections
        let notYetRequestedNonOwnerActiveConnection =
            Array.from(this.activeConnections.keys())
                //.filter(publicKey => this.getPeer(publicKey)!.participatingInSCP)
                .find(publicKey => !alreadyRequestedTo!.has(publicKey));

        if(notYetRequestedNonOwnerActiveConnection) {
            request(notYetRequestedNonOwnerActiveConnection);
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
            if (this.timeouts.get(connection.remoteAddress))
                clearTimeout(this.timeouts.get(connection.remoteAddress));

            if (this.activeConnections.has(connection.remotePublicKey!)) {
                this.activeConnections.delete(connection.remotePublicKey!);
            }
            let hash = this.clearRequestQuorumSet(connection.remotePublicKey!);
            if(hash)
                this.requestQuorumSetFromConnectedNodes(hash);
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



            if (this.peerNodesByPublicKey.has(publicKey)) {//this public key is already used in this crawl! A node is not allowed to reuse public keys. Disconnecting.
                this.logger.error({
                    'peer': connection.remoteAddress,
                    'pk': publicKey
                }, 'Peernode reusing publickey on address ' + this.peerNodesByPublicKey.get(publicKey)!.key);
                connection.destroy();
                return; //we don't return this peernode to consumer of this library
            }

            this.activeConnections.set(publicKey, connection);

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
            if (unknownPeerNodeMatch) {
                peerNode.participatingInSCP = unknownPeerNodeMatch.participatingInSCP;
                peerNode.isValidating = unknownPeerNodeMatch.isValidating;
                peerNode.quorumSet = unknownPeerNodeMatch.quorumSet;
                peerNode.quorumSetHash = unknownPeerNodeMatch.quorumSetHash;
                this.unknownPeerNodesByPublicKey.delete(publicKey);//peerNode no longer unknown

                if(peerNode.quorumSetHash && !peerNode.quorumSet){
                    this.logger.info({'hash': peerNode.quorumSetHash, 'pk': peerNode.publicKey}, 'Priority request');
                    this.quorumSetRequestHashesInProgress.delete(peerNode.quorumSetHash);
                    let currentRequest = this.quorumSetRequests.get(peerNode.publicKey);
                    if(currentRequest) {
                        clearTimeout(currentRequest.timeout);
                        this.quorumSetRequests.delete(peerNode.publicKey);
                    }
                    this.requestQuorumSetFromConnectedNodes(peerNode.quorumSetHash);
                }
            }
            this.peerNodesByPublicKey.set(publicKey, peerNode);
            /*if (!this._nodesThatSuppliedPeerList.has(connection.peer)) { //Most nodes send their peers automatically on successful handshake, better handled with timer.
                this._connectionManager.sendGetPeers(connection);
            }*/
            if (this.validatingPublicKeys.has(publicKey) && peerNode.quorumSet !== undefined) { //we already confirmed that the node is validating by listening to externalize messages propagated by other nodes and we have a quorumset
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

    protected onPeersReceived(connection: Connection, peers: xdr.PeerAddress[]) {
        let peerAddresses: Array<NodeAddress> = [];
        peers.forEach(peer => {
            let ipResult = getIpFromPeerAddress(peer);
            if (ipResult.isOk())
                peerAddresses.push([ipResult.value, peer.port()])
        })

        this.logger.debug({'peer': connection.remoteAddress}, peerAddresses.length + ' peers received');
        let peer = this.peerNodesByPublicKey.get(connection.remotePublicKey!)!;
        peer.suppliedPeerList = true;
        peerAddresses.forEach(peerAddress => this.crawlPeerNode(peerAddress));
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

        if (Number(scpStatement.slotIndex) < this.latestLedgerSequence) {
            return; //older scp messages are ignored.
        }

        this.logger.debug({
            'peer': connection.remoteAddress,
            'publicKey': publicKey,
            'slotIndex': scpStatement.slotIndex().toString()
        }, 'processing new scp statement: ' + scpStatement.pledges().switch().name);

        let peer = this.getPeer(publicKey);
        if (!peer) {
            peer = new UnknownPeerNode(publicKey);
            this.unknownPeerNodesByPublicKey.set(publicKey, peer);
        }

        peer.participatingInSCP = true;
        peer.quorumSetHash = this.getQuorumSetHash(scpStatement);

        if(!this.getQuorumSetHashOwners(peer.quorumSetHash).has(publicKey)){
            this.logger.info({'pk': publicKey, hash: peer.quorumSetHash}, 'Detected quorumSetHash');
        }

        this.getQuorumSetHashOwners(peer.quorumSetHash).add(publicKey);

        if (this.quorumSetMap.has(peer.quorumSetHash))
            peer.quorumSet = this.quorumSetMap.get(peer.quorumSetHash);
        else {
            this.logger.debug({'pk': publicKey}, 'Unknown quorumSet for hash: ' + peer.quorumSetHash);
            this.requestQuorumSetFromConnectedNodes(peer.quorumSetHash);
        }

        if (scpStatement.pledges().switch().value !== ScpStatementType.scpStExternalize().value) { //only if node is externalizing, we mark the node as validating
            return;
        }

        this.processExternalizeStatement(peer, scpStatement.slotIndex().toString(), scpStatement.pledges().externalize())
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
                    if (validatingPeer)
                        markNodeAsValidating(validatingPeer);
                });
            } else { //if the slot was already closed, we check if this new (?) node should be marked as validating
                if (value === slot.externalizedValue)
                    markNodeAsValidating(peer);
            }
        }
    }

    getPeer(publicKey: PublicKey) {
        let peer = this.peerNodesByPublicKey.get(publicKey);
        if (peer)
            return peer;

        return this.unknownPeerNodesByPublicKey.get(publicKey);
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
            let peer = this.getPeer(owner);
            if(peer)
                peer.quorumSet = quorumSet;
        });
        this.clearRequestQuorumSet(connection.remotePublicKey!);
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