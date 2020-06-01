import {Connection, ConnectionManager} from "@stellarbeat/js-stellar-node-connector";
import {Node, QuorumSet} from '@stellarbeat/js-stellar-domain';
import CrawlStatisticsProcessor from "./crawl-statistics-processor";
import * as EventSource from 'eventsource';
import axios from 'axios';

const StellarBase = require('stellar-base');
import * as winston from 'winston';

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

    _busyCounter: number;
    _allNodes: Map<string, Node>;
    _activeConnections: Map<string, Connection>;
    _processedValidatingNodes: Set<PublicKey> = new Set();
    _nodesThatSuppliedPeerList: Set<Node>;
    _keyPair: any /*StellarBase.Keypair*/;
    _usePublicNetwork: boolean;
    _quorumSetHashes: Map<string, Set<string>>;
    _connectionManager: ConnectionManager;
    _resolve: any; //todo typehints
    _reject: any;
    _durationInMilliseconds: number;
    _logger: any;
    _ledgerEventSource: EventSource;
    _ledgerSequence: LedgerSequence = 0;
    _processedLedgers: Set<number> = new Set();
    _nodesToCrawl: Array<Node>;
    _weight: number;
    _maxWeight: number;
    _activeNodeWeight: number;
    _defaultNodeWeight: number;
    _publicKeyToNodeMap: Map<PublicKey, Node> = new Map<PublicKey, Node>();
    _timeouts: Map<string, any> = new Map();
    _nodesParticipatingInSCP: Set<string> = new Set();

    constructor(usePublicNetwork: boolean = true, durationInMilliseconds: number = 30000, logger: any = null) {
        if (!process.env.HORIZON_URL) {
            throw new Error('Horizon not configured');
        }

        this._ledgerEventSource = new EventSource(process.env.HORIZON_URL + "/ledgers?cursor=now");
        this._durationInMilliseconds = durationInMilliseconds;
        this._busyCounter = 0;
        this._allNodes = new Map();
        this._activeConnections = new Map(); //nodes that completed a handshake and we are currently listening to
        this._nodesThatSuppliedPeerList = new Set();
        this._keyPair = StellarBase.Keypair.random();
        this._usePublicNetwork = usePublicNetwork;
        this._quorumSetHashes = new Map();
        if (!logger) {
            this.initializeDefaultLogger();
        } else {
            this._logger = logger;
        }
        this._connectionManager = new ConnectionManager(
            this._usePublicNetwork,
            this.onHandshakeCompleted.bind(this),
            this.onPeersReceived.bind(this),
            this.onLoadTooHighReceived.bind(this),
            this.onSCPStatementReceived.bind(this),
            this.onQuorumSetReceived.bind(this),
            this.onNodeDisconnected.bind(this),
            this._logger
        );

        this._nodesToCrawl = [];
        this._weight = 0;
        this._activeNodeWeight = 100;
        this._defaultNodeWeight = 20;
        this._maxWeight = 400;
    }

    getProcessedLedgers() {
        return Array.from(this._processedLedgers);
    }

    async getLatestLedger() {
        try {
            let result = await axios.get(process.env.HORIZON_URL);
            if(result && result.data && result.data.core_latest_ledger) {
                this._ledgerSequence = result.data.core_latest_ledger;
                this._logger.log('info', "[CRAWLER] Starting ledger: " + this._ledgerSequence);
            }
        } catch (e) {
            throw new Error("Error fetching latest ledger. Stopping crawler. " + e.message);
        }
    }

    setLogger(logger: any) {
        this._logger = logger;
    }

    initializeDefaultLogger() {
        this._logger = winston.createLogger({
            level: process.env.LOG_LEVEL || 'info',
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss'
                }),
                winston.format.printf(info => `[${info.level}] ${info.timestamp} ${info.message}`)
            ),
            transports: [
                new winston.transports.Console()
            ]
        });
    }

    /**
     *
     * @param nodesSeed
     * @returns {Promise<any>}
     */
    async crawl(nodesSeed: Array<Node>): Promise<Array<Node>> {
        this._logger.log('info', "[CRAWLER] Starting crawl with seed of " + nodesSeed.length + "nodes.");
        function compare(a:Node, b: Node) {
            if (a.isValidating && !b.isValidating) {
                return -1;
            }
            if (!a.isValidating && b.isValidating) {
                return 1;
            }
            
            return 0;
        }

        nodesSeed.sort(compare);

        nodesSeed.forEach(node => this._publicKeyToNodeMap.set(node.publicKey, node));

        return await new Promise<Array<Node>>(async (resolve, reject) => {
                this._resolve = resolve;
                this._reject = reject;

                try {
                    await this.getLatestLedger();
                } catch (e) {
                    this._reject(e.message);
                }

                if (this._ledgerSequence !== 0) {
                    nodesSeed.forEach(node => {
                            this.crawlNode(node);
                        }
                    );
                }
            }
        );
    }

    crawlNode(node: Node) {

        if (this._allNodes.has(node.key)) {
            this._logger.log('debug', '[CRAWLER] ' + node.key + ': Node key already used for crawl');
            return;
        }

        this._allNodes.set(node.key, node);
        this._nodesToCrawl.push(node);
        this._busyCounter++;

        this.processCrawlQueue();
    }

    addWeight(node: Node) {
        if (node.statistics.activeInLastCrawl) {  //high chance that we can connect so we dedicate most resources to it
            this._weight += this._activeNodeWeight;
        } else {
            this._weight += this._defaultNodeWeight;
        }
    }

    removeWeight(node: Node) {
        if (node.statistics.activeInLastCrawl) {
            this._weight -= this._activeNodeWeight;
        } else {
            this._weight -= this._defaultNodeWeight;
        }
    }

    processCrawlQueue() {
        while (this._weight < this._maxWeight && this._nodesToCrawl.length > 0) {
            let nextNodeToCrawl = this._nodesToCrawl.shift();
            try {
                this.addWeight(nextNodeToCrawl);
                nextNodeToCrawl.isValidating = false;

                this._logger.log('debug', '[CRAWLER] ' + nextNodeToCrawl.key + ': Start Crawl');

                this._connectionManager.connect(
                    this._keyPair,
                    nextNodeToCrawl,
                    this._durationInMilliseconds
                );
            } catch (exception) {
                this._logger.log('error', '[CRAWLER] ' + nextNodeToCrawl.key + ': Exception: ' + exception.message);
            }
        }
    }

    wrapUp(node: Node) {
        if(this._timeouts.get(node.key))
            clearTimeout(this._timeouts.get(node.key));

        if (this._activeConnections.has(node.key)) {
            this._activeConnections.delete(node.key);
        }

        this.removeWeight(node);

        this._busyCounter--;
        this._logger.log('debug', "[CRAWLER] Processing " + this._busyCounter + " nodes.");

        this.processCrawlQueue();

        if (this._busyCounter === 0) {

            if(this._ledgerEventSource) {
                this._ledgerEventSource.close();
            }

            this._allNodes.forEach((node) => {
                    if (node.publicKey) {
                        this._logger.log('debug', "[CRAWLER] updating node statistics for node: " + node.publicKey);
                        CrawlStatisticsProcessor.updateNodeStatistics(node);
                    }
                }
            );

            this._logger.log('info', "[CRAWLER] Finished with all nodes");
            this._logger.log('info', '[CRAWLER] ' + this._allNodes.size + " nodes crawled of which are active: " + Array.from(this._allNodes.values()).filter(node => node.statistics.activeInLastCrawl).length);
            this._logger.log('info', '[CRAWLER] of which are validating:'  + Array.from(this._allNodes.values()).filter(node => node.statistics.validatingInLastCrawl).length);
            this._logger.log('info', '[CRAWLER] ' + this._nodesThatSuppliedPeerList.size + " supplied us with a peers list.");

            this._resolve(
                Array.from(this._allNodes.values())
            );
        }
    }

    requestQuorumSetFromConnectedNodes(quorumSetHash: string, quorumSetOwnerPublicKey: string) {
        let isSent = false;
        //send to owner
        this._activeConnections.forEach(connection => {
                if (connection.toNode.publicKey === quorumSetOwnerPublicKey) {
                    this._connectionManager.sendGetQuorumSet(Buffer.from(quorumSetHash, 'base64'), connection);
                    isSent = true;
                }
            }
        );

        if (isSent) {
            return;
        }

        //if we are not connected to the owner, send a request to everyone
        this._activeConnections.forEach(connection => {
                this._connectionManager.sendGetQuorumSet(Buffer.from(quorumSetHash, 'base64'), connection);
            }
        );
    }

    /*
    * CONNECTION EVENT LISTENERS
     */
    onNodeDisconnected(connection: Connection) {
        try {
            this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Node disconnected');
            this.wrapUp(connection.toNode);
        } catch (exception) {
            this._logger.log('error', '[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    onHandshakeCompleted(connection: Connection) {

        try {
            this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Handshake succeeded, marking ' + connection.toNode.publicKey + ' as active');
            let node = this._allNodes.get(connection.toNode.key);
            if(node && node.publicKey !== connection.toNode.publicKey ) //node switched publicKey
                this._publicKeyToNodeMap.delete(node.publicKey);

            this._publicKeyToNodeMap.set(connection.toNode.publicKey, connection.toNode);
            this._activeConnections.set(connection.toNode.key, connection);
            /*if (!this._nodesThatSuppliedPeerList.has(connection.toNode)) { //Most nodes send their peers automatically on successful handshake
                this._connectionManager.sendGetPeers(connection);
            }*/
            if(this._processedValidatingNodes.has(connection.toNode.publicKey)) {
                this._logger.log('info', '[CRAWLER] ' + connection.toNode.key + ': ' + connection.toNode.publicKey + ' already confirmed validating, disconnecting');
                this._connectionManager.disconnect(connection);
            } else {
                this.setSCPTimeout(connection.toNode);
                this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': send get scp status message');
                this._connectionManager.sendGetScpStatus(connection, this._ledgerSequence)
            }
        } catch (exception) {
            this._logger.log('error', '[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    onPeersReceived(peers: Array<Node>, connection: Connection) {
        try {
            this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': ' + peers.length + ' peers received');
            this._nodesThatSuppliedPeerList.add(connection.toNode);
            peers.forEach(peer => {
                if (!this._allNodes.has(peer.key)) { //newly discovered toNode
                    this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': supplied a newly discovered peer: ' + peer.key);
                    this.crawlNode(peer);
                } else {
                    this._logger.log('debug', '[CRAWLER] peer ' + peer.key + ' already crawled');
                }
            });
        } catch (exception) {
            this._logger.log('error', '[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }

    }

    onLoadTooHighReceived(connection: Connection) {
        try {
            this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Load too high');
        } catch (exception) {
            this._logger.log('error', '[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    onSCPStatementReceived(connection: Connection, scpStatement: any) {
        this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': ' + scpStatement.type + " message found for node " + scpStatement.nodeId + " for ledger " + scpStatement.slotIndex);

        if (Number(scpStatement.slotIndex) < this._ledgerSequence) {
            return; //older scp messages are ignored.
        }

        let node = this._publicKeyToNodeMap.get(scpStatement.nodeId);
        if(node){
            node.active = true; //node is active
            this._nodesParticipatingInSCP.add(node.key);
        }

        if (scpStatement.type !== 'externalize') { //only if node is externalizing, we mark the node as validating
            return;
        }

        this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Externalize message found for ledger with sequence ' + scpStatement.slotIndex);
        this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': ' + scpStatement.slotIndex + ': ' + scpStatement.nodeId + ': ' + scpStatement.commit.value);
        this._processedLedgers.add(Number(scpStatement.slotIndex)); // todo track values

        this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': ' + scpStatement.nodeId + ' is validating on ledger:  ' + scpStatement.slotIndex);

        let quorumSetHash = scpStatement.quorumSetHash;
        let quorumSetOwnerPublicKey = scpStatement.nodeId;

        try {
            this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Detected quorumSetHash: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);

            if(node){
                if(!node.isValidating) { //first time validating is detected
                    this._logger.log('info', '[CRAWLER] ' + node.key + ': Node is validating on ledger:  ' + scpStatement.slotIndex);
                    node.isValidating = true;
                }
            } else {
                this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Quorumset owner unknown to us, skipping: ' + quorumSetOwnerPublicKey);
                return;
            }

            if (node.quorumSet.hashKey === quorumSetHash) {
                this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Quorumset already known to us for toNode: ' + quorumSetOwnerPublicKey);
                //we don't need any more info for this node, fully processed
                this._processedValidatingNodes.add(node.publicKey);
            } else {
                this._logger.log('info', '[CRAWLER] ' + connection.toNode.key + ': Unknown or modified quorumSetHash for toNode, requesting it: ' + quorumSetOwnerPublicKey);
                let owners = this._quorumSetHashes.get(quorumSetHash);
                if (owners) {
                    if (owners.has(quorumSetOwnerPublicKey)) {
                        this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Already logged quorumSetHash for owner: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);
                    } else {
                        owners.add(quorumSetOwnerPublicKey);
                        this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Logged new owner for quorumSetHash: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);
                    }
                } else {
                    this._quorumSetHashes.set(quorumSetHash, new Set([quorumSetOwnerPublicKey]));
                }
                this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Requesting quorumset: ' + quorumSetHash);

                this.requestQuorumSetFromConnectedNodes(quorumSetHash, quorumSetOwnerPublicKey);
            }
        } catch (exception) {
            this._logger.log('error', '[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    onQuorumSetReceived(connection: Connection, quorumSet: QuorumSet) {
        try {
            this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': QuorumSet received: ' + quorumSet.hashKey);
            let owners = this._quorumSetHashes.get(quorumSet.hashKey);
            if (!owners) {
                return;
            }
            owners.forEach(owner => {
                    let nodeWithNewQuorumSet = this._publicKeyToNodeMap.get(owner);

                    if (nodeWithNewQuorumSet.quorumSet.hashKey === quorumSet.hashKey) {
                        this._logger.log('debug', '[CRAWLER] QuorumSet already updated for toNode: ' + nodeWithNewQuorumSet.publicKey + ' => ' + quorumSet.hashKey);

                    } else {
                        this._logger.log('debug', '[CRAWLER] Updating QuorumSet for toNode: ' + nodeWithNewQuorumSet.publicKey + ' => ' + quorumSet.hashKey);
                        this._processedValidatingNodes.add(owner);

                        nodeWithNewQuorumSet.quorumSet = quorumSet;
                    }
            });
        } catch (exception) {
            this._logger.log('error', '[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    setSCPTimeout(node:Node) {
        this._timeouts.set(node.key, setTimeout(() => {
            this._logger.log('info','[CRAWLER] ' + node.key + ': SCP Listen timeout reached, disconnecting');
            if(this._nodesParticipatingInSCP.has(node.key) && !node.isValidating){
                this._nodesParticipatingInSCP.delete(node.key);
                this._logger.log('info','[CRAWLER] ' + node.key + ': Node was active in SCP, adding more time to listen for externalize messages');
                this.setSCPTimeout(node);
            } else {
                let connection = this._activeConnections.get(node.key);
                if(connection)
                    this._connectionManager.disconnect(connection);
            }
        }, 3000)); //3 seconds to provide first scp message
    }
}