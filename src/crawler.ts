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
    _latestLedgerSequence: number = 0;
    _ledgerSequenceToCheckForNode: Map<PublicKey, LedgerSequence> = new Map();
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
        this._defaultNodeWeight = 10;
        this._maxWeight = 500;
    }

    getProcessedLedgers() {
        return Array.from(this._processedLedgers);
    }

    async getLatestLedger() {
        try {
            let result = await axios.get(process.env.HORIZON_URL);
            if(result && result.data && result.data.core_latest_ledger) {
                this._latestLedgerSequence = result.data.core_latest_ledger;
            }
        } catch (e) {
            throw new Error("Error fetching latest ledger. Stopping crawler. " + e.message);
        }
    }

    async trackLatestLedger() {
        return await new Promise<Array<Node>>((resolve, reject) => {
                let resolved = false;
                if(this._latestLedgerSequence !== 0) {
                    resolve(); //do not wait if there is a start ledger already
                }
                this._ledgerEventSource.addEventListener('message', event => {
                    this._latestLedgerSequence = JSON.parse((event as any).data).sequence;
                    this._logger.log('info', "[CRAWLER] new latest ledger: " + this._latestLedgerSequence);
                    if (!resolved) { //after the first retrieval, the calling function stops waiting, but the retrieval continues
                        resolve();
                    }
                });
                this._ledgerEventSource.onerror = (event: any) => {
                    if (this._latestLedgerSequence === 0) {
                        this._logger.log('error', "[CRAWLER] Error fetching latest ledger: " + event.message + ". Stopping crawler");
                        reject(new Error("Error fetching latest ledger: " + event.message));
                    } else {
                        this._logger.log('error', "[CRAWLER] Error fetching latest ledger: " + event.message + ". Continue with ledger: " + this._latestLedgerSequence);
                        if (!resolved) {
                            resolve();
                        }
                    }
                };
            }
        );
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
        return await new Promise<Array<Node>>(async (resolve, reject) => {
                this._resolve = resolve;
                this._reject = reject;

                try {
                    await this.getLatestLedger();
                    await this.trackLatestLedger();
                } catch (e) {
                    this._reject(e.message);
                }

                if (this._latestLedgerSequence !== 0) {
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
            this._weight += 100;
        } else {
            this._weight += 2; //connect to 50 unknown nodes at a time
        }
    }

    removeWeight(node: Node) {
        if (node.statistics.activeInLastCrawl) {
            this._weight -= 100;
        } else {
            this._weight -= 2;
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
            this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Handshake succeeded, marking toNode as active');
            this._publicKeyToNodeMap.set(connection.toNode.publicKey, connection.toNode);
            this._activeConnections.set(connection.toNode.key, connection);
            if (!this._nodesThatSuppliedPeerList.has(connection.toNode)) {
                this._connectionManager.sendGetPeers(connection);
            }
            this._ledgerSequenceToCheckForNode.set(connection.toNode.publicKey, this._latestLedgerSequence);
            this.setSCPTimeout(connection.toNode);
            /*this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': checking ledger with sequence: ' + this._ledgerSequenceToCheckForNode.get(connection.toNode.publicKey));*/
            //this._connectionManager.sendGetScpStatus(connection, this._ledgerSequenceToCheckForNode.get(connection.toNode.publicKey))
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

        if (this._ledgerSequenceToCheckForNode.get(connection.toNode.publicKey) > Number(scpStatement.slotIndex)) {
            return; //older scp messages are ignored.
        }

        let node = this._publicKeyToNodeMap.get(scpStatement.nodeId);
        if(node){
            node.active = true; //node is active
            node.isValidator = true; //participates in consensus
            this._nodesParticipatingInSCP.add(node.key);
        }

        if (scpStatement.type !== 'externalize') { //only if node is externalizing, we mark the node as validating
            return;
        }

        this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Externalize message found for ledger with sequence ' + scpStatement.slotIndex);
        this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': ' + scpStatement.slotIndex + ': ' + scpStatement.nodeId + ': ' + scpStatement.commit.value);
        this._processedLedgers.add(Number(scpStatement.slotIndex)); // todo track values

        let quorumSetHash = scpStatement.quorumSetHash;
        let quorumSetOwnerPublicKey = scpStatement.nodeId;

        try {
            this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Detected quorumSetHash: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);

            if(node){
                node.active = true;
                node.isValidating = true;
            } else {
                this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Quorumset owner unknown to us, skipping: ' + quorumSetOwnerPublicKey);
                return;
            }

            if (node.quorumSet.hashKey === quorumSetHash) {
                this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Quorumset already known to us for toNode: ' + quorumSetOwnerPublicKey);
                let ownerConnection = this._activeConnections.get(node.key);
                if(ownerConnection) {
                    this._logger.log('debug', '[CRAWLER] ' + quorumSetOwnerPublicKey + ': Node is validating and we have quorumset representation: disconnecting');
                    this._connectionManager.disconnect(ownerConnection);//we have all the info we need from this node
                }

            } else {
                this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Unknown or modified quorumSetHash for toNode, requesting it: ' + quorumSetOwnerPublicKey);
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
            owners.forEach(nodePublicKey => {
                let nodes = [...this._allNodes.values()].filter(node => node.publicKey === nodePublicKey).forEach( //node could have switched ip, and thus it is now twice in the list with the same public key.
                    nodeWithNewQuorumSet => {
                        if (nodeWithNewQuorumSet.quorumSet.hashKey === quorumSet.hashKey) {
                            this._logger.log('debug', '[CRAWLER] QuorumSet already updated for toNode: ' + nodeWithNewQuorumSet.publicKey + ' => ' + quorumSet.hashKey);

                        } else {
                            this._logger.log('debug', '[CRAWLER] Updating QuorumSet for toNode: ' + nodeWithNewQuorumSet.publicKey + ' => ' + quorumSet.hashKey);
                            nodeWithNewQuorumSet.quorumSet = quorumSet;
                        }
                        if(nodeWithNewQuorumSet.isValidating){
                            let ownerConnection = this._activeConnections.get(nodeWithNewQuorumSet.key);
                            if(ownerConnection) {
                                this._logger.log('debug', '[CRAWLER] ' + nodeWithNewQuorumSet.publicKey + ': Node is validating and we have quorumset representation: disconnecting');
                                this._connectionManager.disconnect(ownerConnection);//we have all the info we need from this node
                            }
                        }

                    }
                );
            });
        } catch (exception) {
            this._logger.log('error', '[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    setSCPTimeout(node:Node) {
        this._timeouts.set(node.key, setTimeout(() => {
            this._logger.log('info','[CRAWLER] ' + node.publicKey + ': SCP Listen timeout reached, disconnecting');
            if(this._nodesParticipatingInSCP.has(node.key)){
                this._nodesParticipatingInSCP.delete(node.key);
                this._logger.log('info','[CRAWLER] ' + node.publicKey + ': Node was active in SCP, adding more time to listen for externalize messages');
                this.setSCPTimeout(node);
            } else {
                let connection = this._activeConnections.get(node.key);
                if(connection)
                    this._connectionManager.disconnect(connection);
            }
        }, 5000)); //5 seconds to provide first scp message
    }
}