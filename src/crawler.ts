import {Connection, ConnectionManager} from "@stellarbeat/js-stellar-node-connector";
import {Node, QuorumSet} from '@stellarbeat/js-stellar-domain';
import CrawlStatisticsProcessor from "./crawl-statistics-processor";

const StellarBase = require('stellar-base');
import * as winston from 'winston';

require('dotenv').config();

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

    _nodesToCrawl: Array<Node>;
    _weight: number;
    _maxWeight: number;
    _activeNodeWeight: number;
    _defaultNodeWeight: number;

    constructor(usePublicNetwork: boolean = true, durationInMilliseconds: number = 3000, logger: any = null) {
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
            this.onQuorumSetHashDetected.bind(this),
            this.onQuorumSetReceived.bind(this),
            this.onNodeDisconnected.bind(this),
            this._logger
        );

        this._nodesToCrawl = [];
        this._weight = 0;
        this._activeNodeWeight = 100;
        this._defaultNodeWeight = 2;
        this._maxWeight = 100;
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
    crawl(nodesSeed: Array<Node>) {
        this._logger.log('info', "[CRAWLER] Starting crawl with seed of " + nodesSeed.length + "nodes.");
        return new Promise((resolve, reject) => {
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

                this._logger.log('debug', '[CRAWLER] ' + nextNodeToCrawl.key + ': Start Crawl');
                console.time(nextNodeToCrawl.key);

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


            this._logger.log('info',"[CRAWLER] Finished with all nodes");
            this._logger.log('info','[CRAWLER] ' + this._allNodes.size + " nodes crawled of which are active: " + Array.from(this._allNodes.values()).filter(node => node.statistics.activeInLastCrawl).length);
            this._logger.log('info','[CRAWLER] ' + this._nodesThatSuppliedPeerList.size + " supplied us with a peers list.");

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
        console.log("timing");
        console.timeEnd(connection.toNode.key);

        try {
            this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Handshake succeeded, marking toNode as active');
            //filter out nodes that switched ip address //@todo: correct location?
            [...this._allNodes.values()].forEach(node => {
                if (node.publicKey === undefined || node.publicKey === null) {
                    return;
                }
                if (node.publicKey === connection.toNode.publicKey && node.key !== connection.toNode.key) {
                    this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': toNode switched ip, discard the old one.');
                    connection.toNode.statistics = node.statistics; //transfer the statistics. todo: should we log this?
                    this._allNodes.delete(node.key);
                }
            });
            let publicKey = connection.toNode.publicKey;
            if (!publicKey) {
                throw new Error('hello message did not supply public key');
            }
            this._activeConnections.set(connection.toNode.key, connection);
            if (!this._nodesThatSuppliedPeerList.has(connection.toNode)) {
                this._connectionManager.sendGetPeers(connection);
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

    onQuorumSetHashDetected(connection: Connection, quorumSetHash: string, quorumSetOwnerPublicKey: string) {
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