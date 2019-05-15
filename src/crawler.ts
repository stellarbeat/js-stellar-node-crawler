import {Connection, ConnectionManager} from "@stellarbeat/js-stellar-node-connector";
import {Node, QuorumSet} from '@stellarbeat/js-stellar-domain';
import CrawlStatisticsProcessor from "./crawl-statistics-processor";
import * as EventSource from 'eventsource';

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
    _latestLedgerSequence: number = 20;
    _ledgerSequenceToCheckForNode: Map<PublicKey, LedgerSequence> = new Map();
    _ledgers: Map<PublicKey, Ledger> = new Map<PublicKey, Ledger>();
    _nodesToCrawl: Array<Node>;
    _weight: number;
    _maxWeight: number;
    _activeNodeWeight: number;
    _defaultNodeWeight: number;
    _publicKeyToNodeMap: Map<PublicKey, Node> = new Map<PublicKey, Node>();

    constructor(usePublicNetwork: boolean = true, durationInMilliseconds: number = 3000, logger: any = null) {
        if (!process.env.HORIZON_URL) {
            throw new Error('Horizon not configured');
        }
        this._ledgerEventSource = new EventSource(process.env.HORIZON_URL + "/ledgers?cursor=now");
        this._ledgerEventSource.onerror = function() {
            console.log("EventSource failed.");
        };
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

    async trackLatestLedger() {
        return new Promise<Array<Node>>((resolve, reject) => {
                let resolved = false;

                this._ledgerEventSource.addEventListener('message', event => {
                    this._latestLedgerSequence = JSON.parse(event.data).sequence;
                    console.log("new latest ledger: " + this._latestLedgerSequence);
                    if (!resolved) {
                        resolve();
                    }
                }, false);
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
        await this.trackLatestLedger();

        this._logger.log('info', "[CRAWLER] Starting crawl with seed of " + nodesSeed.length + "nodes.");
        return new Promise<Array<Node>>((resolve, reject) => {
                this._resolve = resolve;
                this._reject = reject;

                nodesSeed.forEach(node => {
                        this.crawlNode(node);
                    }
                );
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
        if (this._activeConnections.has(node.key)) {
            this._activeConnections.delete(node.key);
        }

        this.removeWeight(node);


        this._busyCounter--;
        this._logger.log('debug', "[CRAWLER] Processing " + this._busyCounter + " nodes.");

        this.processCrawlQueue();
        CrawlStatisticsProcessor.updateNodeStatistics(node);

        if (this._busyCounter === 0) {


            this._logger.log('info', "[CRAWLER] Finished with all nodes");
            this._logger.log('info', '[CRAWLER] ' + this._allNodes.size + " nodes crawled of which are active: " + Array.from(this._allNodes.values()).filter(node => node.statistics.activeInLastCrawl).length);
            this._logger.log('info', '[CRAWLER] ' + this._nodesThatSuppliedPeerList.size + " supplied us with a peers list.");

            this._ledgerEventSource.close();
            this._ledgers.forEach((ledger: Ledger, publicKey: PublicKey,) => {
                (ledger as Ledger).values.forEach((value: string, publicKey: PublicKey) => {
                    let validatingNode = this._publicKeyToNodeMap.get(publicKey);
                    if (validatingNode) {
                        validatingNode.isValidating = true;
                        //todo: check values
                    }
                })
            });

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
            console.log('[CRAWLER] ' + connection.toNode.key + ': checking ledger with sequence: ' + this._ledgerSequenceToCheckForNode.get(connection.toNode.publicKey));
            this._connectionManager.sendGetScpStatus(connection, this._ledgerSequenceToCheckForNode.get(connection.toNode.publicKey))
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
        if (scpStatement.type !== 'externalize') {
            return;
        }

        if (this._ledgerSequenceToCheckForNode.get(connection.toNode.publicKey) !== Number(scpStatement.slotIndex)) {
            return; // we only check 1 ledger for every node
        }

        console.log('[CRAWLER] ' + connection.toNode.key + ': Externalize message found for ledger with sequence ' + scpStatement.slotIndex)
        let ledger = this._ledgers.get(connection.toNode.publicKey);
        if (ledger === undefined) {
            ledger = {
                node: connection.toNode,
                ledgerId: Number(scpStatement.slotIndex),
                values: new Map()
            };
            this._ledgers.set(connection.toNode.publicKey, ledger);
        }
        ledger.values.set(scpStatement.nodeId, scpStatement.commit.value);
        console.log('[CRAWLER] ' + connection.toNode.key + ': ' + scpStatement.slotIndex + ': ' + scpStatement.nodeId + ': ' + scpStatement.commit.value);

        let quorumSetHash = scpStatement.quorumSetHash;
        let quorumSetOwnerPublicKey = scpStatement.nodeId;

        try {
            this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Detected quorumSetHash: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);

            let node = null;
            let nodes = [...this._allNodes.values()]
                .filter(node => node.publicKey === quorumSetOwnerPublicKey);

            if (nodes.length > 0) {
                node = nodes[0];
                node.active = true; //node is active in scp todo: differentiate between different active status (can connect to it & is active in scp)
            } else {
                this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Quorumset owner unknown to us, skipping: ' + quorumSetOwnerPublicKey);
                return;
            }

            if (node.quorumSet.hashKey === quorumSetHash) {
                this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Quorumset already known to us for toNode: ' + quorumSetOwnerPublicKey);
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

                    }
                );
            });
        } catch (exception) {
            this._logger.log('error', '[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }
}