import {Node, QuorumSet} from '@stellarbeat/js-stellar-domain';
import axios from 'axios';

import * as winston from 'winston';
import {
    PeerNode,
    Connection,
    ConnectionManager,
    getConfigFromEnv,
    getPublicKeyStringFromBuffer,
    getIpFromPeerAddress
} from "@stellarbeat/js-stellar-node-connector";
import {xdr} from "stellar-base";
import LRUCache = require("lru-cache");
import StellarMessage = xdr.StellarMessage;
import MessageType = xdr.MessageType;
import ScpStatement = xdr.ScpStatement;
import ScpStatementType = xdr.ScpStatementType;

type PublicKey = string;
type LedgerSequence = number;

interface Ledger {
    node: Node;
    ledgerId: number;
    values: Map<publicKey, string>;
}

require('dotenv').config();

type publicKey = string;

export class Crawler {

    protected busyCounter: number;
    protected allPeerNodes: Map<string, PeerNode>;
    protected activeConnections: Map<string, Connection>;
    protected processedValidatingNodes: Set<PublicKey> = new Set();
    protected nodesThatSuppliedPeerList: Set<PeerNode>;
    protected usePublicNetwork: boolean;
    protected quorumSetHashes: Map<string, Set<string>>;
    protected connectionManager: ConnectionManager;
    protected resolve: any; //todo typehints
    protected reject: any;
    protected logger: any;
    protected ledgerSequence: LedgerSequence = 0;
    protected processedLedgers: Set<number> = new Set();
    protected nodesToCrawl: Array<PeerNode>;
    protected weight: number;
    protected maxWeight: number;
    protected activeNodeWeight: number;
    protected defaultNodeWeight: number;
    protected publicKeyToNodeMap: Map<PublicKey, Node> = new Map<PublicKey, Node>();
    protected timeouts: Map<string, any> = new Map();
    protected peerNodesParticipatingInSCP: Set<string> = new Set();
    protected prioritizedPeerNodes: Set<string> = new Set();
    protected nodesActiveInLastCrawl: Set<PublicKey> = new Set();
    protected pass: number = 1;
    protected envelopeCache = new LRUCache(5000);

    public horizonLatestLedger: number = 0;

    //todo: network string instead of boolean
    constructor(usePublicNetwork: boolean = true, logger: any = null) {
        if (!process.env.HORIZON_URL) {
            throw new Error('Horizon not configured');
        }
        this.busyCounter = 0;
        this.allPeerNodes = new Map();
        this.activeConnections = new Map(); //nodes that completed a handshake and we are currently listening to
        this.nodesThatSuppliedPeerList = new Set();
        this.usePublicNetwork = usePublicNetwork;
        this.quorumSetHashes = new Map();
        if (!logger) {
            this.initializeDefaultLogger();
        } else {
            this.logger = logger;
        }
        this.connectionManager = new ConnectionManager(
            this.usePublicNetwork,
            getConfigFromEnv(),
            this.logger
        );

        this.nodesToCrawl = [];
        this.weight = 0;
        this.activeNodeWeight = 100;
        this.defaultNodeWeight = 20;
        this.maxWeight = 40000;
    }

    getProcessedLedgers() {
        return Array.from(this.processedLedgers);
    }

    protected async getLatestLedger() {//todo: refactor out horizon to higher layer
        if (!process.env.HORIZON_URL)
            throw new Error('HORIZON URL env not configured');
        try {
            let result = await axios.get(process.env.HORIZON_URL);
            if(result && result.data && result.data.core_latest_ledger) {
                if(this.horizonLatestLedger !== result.data.core_latest_ledger){//horizon has a new ledger
                    this.horizonLatestLedger = result.data.core_latest_ledger;
                    this.ledgerSequence = result.data.core_latest_ledger;
                } else {
                    this.logger.warn("[CRAWLER] horizon latest ledger not updated: " + result.data.core_latest_ledger + "Network halted? Trying out next ledger");
                    this.ledgerSequence ++;
                }
            } else {
                this.ledgerSequence ++;
                this.logger.error("[CRAWLER] Could not fetch latest ledger from horizon, using next ledger as fallback " + this.ledgerSequence);
            }
        } catch (e) {
            this.ledgerSequence ++;
            this.logger.error("Error fetching latest ledger from horizon, using next ledger as fallback " + e.message);
        }
        this.ledgerSequence++;
        this.logger.info("[CRAWLER] Checking validating states based on latest ledger: " + this.ledgerSequence);
    }

    setLogger(logger: any) {
        this.logger = logger;
    }

    protected initializeDefaultLogger() {
        this.logger = require('pino')();
        return;
        this.logger = winston.createLogger({
            level: process.env.LOG_LEVEL || 'info',
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss'
                }),
                winston.format.printf(info => `[${info.level}] ${info.timestamp} ${info.message}`)
            ),
            transports: [
                new winston.transports.Console({
                    silent: false
                })
            ],
            defaultMeta: {
                app: 'Crawler'
            }
        });
    }

    /**
     * @param nodesSeed
     * @param horizonLatestLedger too check if the ledger is advancing.
     */
    async crawl(nodesSeed: Array<Node>, horizonLatestLedger: number = 0): Promise<Array<Node>> {
        this.ledgerSequence = horizonLatestLedger;
        this.pass = 1;
        this.logger.info("[CRAWLER] Starting crawl with seed of " + nodesSeed.length + "nodes.");

        function compare(a: Node, b: Node) {
            if (a.isValidating && !b.isValidating) {
                return -1;
            }
            if (!a.isValidating && b.isValidating) {
                return 1;
            }

            return 0;
        }

        nodesSeed.sort(compare);

        nodesSeed.forEach(node => this.publicKeyToNodeMap.set(node.publicKey, node));

        return await new Promise<Array<Node>>(async (resolve, reject) => {
                this.resolve = resolve;
                this.reject = reject;

                try {
                    await this.getLatestLedger();
                } catch (e) {
                    this.reject(e.message);
                }

                if (this.ledgerSequence !== 0) {
                    nodesSeed.forEach(node => this.crawlNode(node));
                }
            }
        );
    }

    crawlNode(node: Node) {
        if (node.active)
            this.nodesActiveInLastCrawl.add(node.publicKey);
        node.active = false;
        node.isValidating = false;
        node.overLoaded = false;

        let peerNode = new PeerNode(node.ip, node.port);
        peerNode.publicKey = node.publicKey;
        this.crawlPeerNode(peerNode);
    }

    protected crawlPeerNode(node: PeerNode) {
        if (this.allPeerNodes.has(node.key)) {
            this.logger.debug('[CRAWLER] ' + node.key + ': Node key already used for crawl');
            return;
        }
        this.logger.debug('[CRAWLER] ' + node.key + ': Adding node to crawl queue');
        this.allPeerNodes.set(node.key, node);
        this.nodesToCrawl.push(node);
        this.busyCounter++;

        this.processCrawlQueue();
    }

    protected addWeight(node: PeerNode) {
        if (node.publicKey
            && this.publicKeyToNodeMap.get(node.publicKey)
            && this.nodesActiveInLastCrawl.has(node.publicKey)) {
            this.prioritizedPeerNodes.add(node.key);
            this.weight += this.activeNodeWeight;
        } //high chance that we can connect so we dedicate most resources to it
        else {
            this.weight += this.defaultNodeWeight;
        }
    }

    removeWeight(node: PeerNode) {
        if (this.prioritizedPeerNodes.has(node.key)) {
            this.weight -= this.activeNodeWeight;
        } else {
            this.weight -= this.defaultNodeWeight;
        }
    }

    processCrawlQueue() {
        while (this.weight < this.maxWeight && this.nodesToCrawl.length > 0) {
            let nextNodeToCrawl = this.nodesToCrawl.shift()!;
            try {
                this.addWeight(nextNodeToCrawl);

                this.logger.debug('[CRAWLER] ' + nextNodeToCrawl.key + ': Start Crawl');

                let connection = this.connectionManager.connect(
                    nextNodeToCrawl.ip,
                    nextNodeToCrawl.port
                );
                connection.on("connect", () => this.onHandshakeCompleted(connection));
                connection.on("error", (error: Error) => console.log(error));
                connection.on("data", (stellarMessage: StellarMessage) => {
                    if (stellarMessage.switch().value === MessageType.scpMessage().value) {
                        if (this.envelopeCache.has(stellarMessage.envelope().signature().toString())) {
                            return;
                        }
                        this.envelopeCache.set(stellarMessage.envelope().signature().toString(), 1);
                        this.onSCPStatementReceived(connection, stellarMessage.envelope().statement())
                    }
                    if (stellarMessage.switch().value === MessageType.peers().value)
                        this.onPeersReceived(
                            stellarMessage.peers().map(peer => {
                                return new PeerNode(
                                    getIpFromPeerAddress(peer),
                                    peer.port()
                                )
                            }), connection);
                });
                connection.on('timeout', () => {
                    console.log("timeout");
                    connection.destroy();
                });
                connection.on("close", () => this.onNodeDisconnected(connection));
            } catch (exception) {
                this.logger.error('[CRAWLER] ' + nextNodeToCrawl.key + ': Exception: ' + exception.message);
            }
        }
    }

    wrapUp(node: PeerNode) {
        if (this.timeouts.get(node.key))
            clearTimeout(this.timeouts.get(node.key));

        if (this.activeConnections.has(node.key)) {
            this.activeConnections.delete(node.key);
        }

        this.removeWeight(node);

        this.busyCounter--;
        this.logger.info("[CRAWLER] Processing " + this.busyCounter + " nodes.");
        //console.log(Array.from(this._activeConnections.values()).map(con => con.toNode))

        this.processCrawlQueue();
        if (this.busyCounter === 0) {//stop the crawler
            let validatorsToRetry: Node[] = [];
            if (this.pass === 1) {
                this.pass++;
                validatorsToRetry = Array.from(this.publicKeyToNodeMap.values())
                    .filter(node => node.active && node.isValidator && !node.isValidating);
                validatorsToRetry
                    .forEach(validator => {
                        this.logger.info("[CRAWLER] retrying: " + validator.publicKey);
                        let peerNode = this.allPeerNodes.get(validator.key);
                        if (!peerNode)
                            return;
                        this.allPeerNodes.delete(validator.key);
                        this.crawlPeerNode(peerNode);
                    })
            }

            if (validatorsToRetry.length === 0) {
                this.logger.info("[CRAWLER] Finished with all nodes");
                this.logger.info('[CRAWLER] ' + this.allPeerNodes.size + " nodes crawled of which are active: " + Array.from(this.publicKeyToNodeMap.values()).filter(node => node.active).length);
                this.logger.info('[CRAWLER] of which are validating: ' + Array.from(this.publicKeyToNodeMap.values()).filter(node => node.isValidating).length);
                this.logger.info('[CRAWLER] of which are overloaded: ' + Array.from(this.publicKeyToNodeMap.values()).filter(node => node.overLoaded).length);
                this.logger.info('[CRAWLER] ' + this.nodesThatSuppliedPeerList.size + " supplied us with a peers list.");

                this.resolve(
                    Array.from(this.publicKeyToNodeMap.values())
                );
            }
        }
    }

    requestQuorumSetFromConnectedNodes(quorumSetHash: string, quorumSetOwnerPublicKey: string) {
        let isSent = false;
        //send to owner
        this.activeConnections.forEach(connection => {
                if (connection.toNode!.publicKey === quorumSetOwnerPublicKey) {
                    connection.sendStellarMessage(StellarMessage.getScpQuorumset(Buffer.from(quorumSetHash, 'base64')));
                    isSent = true;
                }
            }
        );

        if (isSent) {
            return;
        }

        //if we are not connected to the owner, send a request to everyone
        this.activeConnections.forEach(connection => {
                connection.sendStellarMessage(StellarMessage.getScpQuorumset(Buffer.from(quorumSetHash, 'base64')));
            }
        );
    }

    /*
    * CONNECTION EVENT LISTENERS
     */
    onNodeDisconnected(connection: Connection) {
        try {
            this.logger.info('[CRAWLER] ' + connection.toNode.key + ': Node disconnected');
            if (connection.toNode.publicKey && this.processedValidatingNodes.has(connection.toNode.publicKey)) { //if a node cant complete the handshake, but it is confirmed through other nodes that it is active and validating, we mark it as such.
                let node = this.publicKeyToNodeMap.get(connection.toNode.publicKey);
                if (node && !node.active) {
                    this.logger.info('[CRAWLER] ' + connection.toNode.key + ': Node did not complete handshake, but is confirmed validating. Marking node as overloaded and validating.');
                    node.overLoaded = true;
                    node.active = true;
                    node.isValidating = true;
                } //node didn't complete handshake, but it is confirmed validating and thus active. This happens when the node has a high load and can't process messages quickly enough.
            }
            this.wrapUp(connection.toNode);
        } catch (exception) {
            this.logger.error('[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    onHandshakeCompleted(connection: Connection) {
        try {
            this.logger.info('[CRAWLER] ' + connection.toNode.key + ': Handshake succeeded, marking ' + connection.toNode.publicKey + ' as active');
            if (!connection.toNode.publicKey)
                throw new Error('peernode missing publickey: ' + connection.toNode.key);

            let node = this.publicKeyToNodeMap.get(connection.toNode.publicKey);
            if (!node) {
                node = new Node(connection.toNode.publicKey, connection.toNode.ip, connection.toNode.port);
                this.publicKeyToNodeMap.set(node.publicKey, node);
            }
            node.active = true;
            if (node.ip !== connection.toNode.ip) {
                this.logger.info('[CRAWLER] ' + connection.toNode.key + ': ' + connection.toNode.publicKey + ' switched IP');
            }
            node.ip = connection.toNode.ip;
            node.port = connection.toNode.port;
            node.ledgerVersion = connection.toNode.ledgerVersion;
            node.overlayVersion = connection.toNode.overlayVersion;
            node.overlayMinVersion = connection.toNode.overlayMinVersion;
            node.networkId = connection.toNode.networkId;
            node.versionStr = connection.toNode.versionStr;

            this.activeConnections.set(connection.toNode.key, connection);
            /*if (!this._nodesThatSuppliedPeerList.has(connection.toNode)) { //Most nodes send their peers automatically on successful handshake
                this._connectionManager.sendGetPeers(connection);
            }*/
            if (this.processedValidatingNodes.has(node.publicKey)) { //we already confirmed that the node is validating by listening to externalize messages propagated by other nodes.
                this.logger.info('[CRAWLER] ' + connection.toNode.key + ': ' + connection.toNode.publicKey + ' already confirmed validating, disconnecting');
                node.isValidating = true;
                connection.destroy();
            } else {
                this.setSCPTimeout(connection.toNode); //todo rename to peernode
                this.logger.debug('[CRAWLER] ' + connection.toNode.key + ': send get scp status message');
                connection.sendStellarMessage(StellarMessage.getScpState(0));
                //this._connectionManager.sendGetScpStatus(connection, this._ledgerSequence)
            }
        } catch (exception) {
            this.logger.error('[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    onPeersReceived(peers: Array<PeerNode>, connection: Connection) {
        try {
            this.logger.debug('[CRAWLER] ' + connection.toNode.key + ': ' + peers.length + ' peers received');
            this.nodesThatSuppliedPeerList.add(connection.toNode);
            peers.forEach(peer => {
                if (!this.allPeerNodes.has(peer.key)) { //newly discovered toNode
                    this.logger.debug('[CRAWLER] ' + connection.toNode.key + ': supplied a newly discovered peer: ' + peer.key);
                    this.crawlPeerNode(peer);
                } else {
                    this.logger.debug('[CRAWLER] peer ' + peer.key + ' already crawled');
                }
            });
        } catch (exception) {
            this.logger.error('[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }

    }

    onLoadTooHighReceived(connection: Connection) {
        try {
            this.logger.info('[CRAWLER] ' + connection.toNode.key + ': Load too high message received, disconnected');
            if (connection.toNode.publicKey) {
                let node = this.publicKeyToNodeMap.get(connection.toNode.publicKey);
                if (node) {
                    node.active = true;
                    node.overLoaded = true;
                }
            }
        } catch (exception) {
            this.logger.error('[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    onSCPStatementReceived(connection: Connection, scpStatement: ScpStatement) {

        let publicKey = getPublicKeyStringFromBuffer(scpStatement.nodeId().value());
        this.logger.debug('[CRAWLER] ' + connection.toNode.key + ': ' + scpStatement.pledges().switch().name + " message found for node " + publicKey + " for ledger " + scpStatement.slotIndex.toString());

        if (Number(scpStatement.slotIndex) < this.ledgerSequence) {
            return; //older scp messages are ignored.
        }

        let node = this.publicKeyToNodeMap.get(publicKey);
        if (node) {
            this.peerNodesParticipatingInSCP.add(node.key);
        }

        if (scpStatement.pledges().switch().value !== ScpStatementType.scpStExternalize().value) { //only if node is externalizing, we mark the node as validating
            return;
        }

        this.logger.debug('[CRAWLER] ' + connection.toNode.key + ': Externalize message found for ledger with sequence ' + scpStatement.slotIndex);
        this.logger.debug('[CRAWLER] ' + connection.toNode.key + ': ' + scpStatement.slotIndex + ': ' + scpStatement.nodeId + ': ' + scpStatement.pledges().externalize().commit().value);
        this.processedLedgers.add(Number(scpStatement.slotIndex)); // todo track values

        this.logger.debug('[CRAWLER] ' + connection.toNode.key + ': ' + scpStatement.nodeId + ' is validating on ledger:  ' + scpStatement.slotIndex);

        let quorumSetHash = scpStatement.pledges().externalize().commitQuorumSetHash().toString('base64');
        let quorumSetOwnerPublicKey = publicKey;

        try {
            this.logger.debug('[CRAWLER] ' + connection.toNode.key + ': Detected quorumSetHash: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);

            if (node) {
                if (node.active)//we have successfully connected to node already, so we mark it as validating
                {
                    if (!node.isValidating) { //first time validating is detected
                        this.logger.info('[CRAWLER] ' + node.key + ': Node is validating on ledger:  ' + scpStatement.slotIndex);
                        node.isValidating = true;
                    }
                }
            } else {
                this.logger.debug('[CRAWLER] ' + connection.toNode.key + ': Quorumset owner unknown to us, skipping: ' + quorumSetOwnerPublicKey);
                return;
            }

            if (node.quorumSet.hashKey === quorumSetHash) {
                this.logger.debug('[CRAWLER] ' + connection.toNode.key + ': Quorumset already known to us for toNode: ' + quorumSetOwnerPublicKey);
                //we don't need any more info for this node, fully processed
                this.processedValidatingNodes.add(node.publicKey); //node is confirmed validating and we have the quorumset. If we connect to it in the future, we can disconnect immediately and mark it as validating.//todo: disconnect if currently connected?
            } else {
                this.logger.info('[CRAWLER] ' + connection.toNode.key + ': Unknown or modified quorumSetHash for toNode, requesting it: ' + quorumSetOwnerPublicKey + ' => ' + quorumSetHash);
                let owners = this.quorumSetHashes.get(quorumSetHash);
                if (owners) {
                    if (owners.has(quorumSetOwnerPublicKey)) {
                        this.logger.debug('[CRAWLER] ' + connection.toNode.key + ': Already logged quorumSetHash for owner: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);
                    } else {
                        owners.add(quorumSetOwnerPublicKey);
                        this.logger.debug('[CRAWLER] ' + connection.toNode.key + ': Logged new owner for quorumSetHash: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);
                    }
                } else {
                    this.quorumSetHashes.set(quorumSetHash, new Set([quorumSetOwnerPublicKey]));
                }
                this.logger.debug('[CRAWLER] ' + connection.toNode.key + ': Requesting quorumset: ' + quorumSetHash);

                this.requestQuorumSetFromConnectedNodes(quorumSetHash, quorumSetOwnerPublicKey);
            }
        } catch (exception) {
            this.logger.error('[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    onQuorumSetReceived(connection: Connection, quorumSet: QuorumSet) {
        try {
            this.logger.info('[CRAWLER] ' + connection.toNode.key + ': QuorumSet received: ' + quorumSet.hashKey);
            if (!quorumSet.hashKey)
                throw new Error('Missing hashkey for quorumset');
            let owners = this.quorumSetHashes.get(quorumSet.hashKey);
            if (!owners) {
                return;
            }
            owners.forEach(owner => {
                let nodeWithNewQuorumSet = this.publicKeyToNodeMap.get(owner);
                if (!nodeWithNewQuorumSet)
                    return;

                if (nodeWithNewQuorumSet.quorumSet.hashKey === quorumSet.hashKey) {
                    this.logger.debug('[CRAWLER] QuorumSet already updated for toNode: ' + nodeWithNewQuorumSet.publicKey + ' => ' + quorumSet.hashKey);

                } else {
                    this.logger.debug('[CRAWLER] Updating QuorumSet for toNode: ' + nodeWithNewQuorumSet.publicKey + ' => ' + quorumSet.hashKey);
                    this.processedValidatingNodes.add(owner); //the node is validating because we only request quorumSets from externalize messages.

                    nodeWithNewQuorumSet.quorumSet = quorumSet;
                }
            });
        } catch (exception) {
            this.logger.error('[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    setSCPTimeout(peerNode: PeerNode) {
        this.timeouts.set(peerNode.key, setTimeout(() => {
            this.logger.info('[CRAWLER] ' + peerNode.key + ': SCP Listen timeout reached, disconnecting');
            if (!peerNode.publicKey)
                throw new Error('peernode is missing publickey: ' + peerNode.key);

            let node = this.publicKeyToNodeMap.get(peerNode.publicKey);
            if (this.peerNodesParticipatingInSCP.has(peerNode.key) && node && !node.isValidating) {
                //a node could be reusing it's publickey on multiple ip's and thus be mapped to multiple peerNodes
                this.peerNodesParticipatingInSCP.delete(node.key);
                this.logger.info('[CRAWLER] ' + node.key + ': Node was active in SCP, adding more time to listen for externalize messages');
                this.setSCPTimeout(peerNode);
            } else {
                let connection = this.activeConnections.get(peerNode.key);
                if (connection)
                    connection.destroy();
            }
        }, 5000)); //5 seconds for first scp message, correlated with Herder::EXP_LEDGER_TIMESPAN_SECONDS
    }
}