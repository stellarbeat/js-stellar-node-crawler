// @flow
const Connection = require("@stellarbeat/js-stellar-node-connector").Connection;
const Node = require('@stellarbeat/js-stellar-domain').Node;
const QuorumSet = require('@stellarbeat/js-stellar-domain').QuorumSet;
const ConnectionManager = require("@stellarbeat/js-stellar-node-connector").ConnectionManager;
const CrawlStatisticsProcessor = require("./crawl-statistics-processor");
const StellarBase = require('stellar-base');
const winston = require('winston');
require('dotenv').config();

class Crawler {

    _busyCounter: number;
    _allNodes: Map<string, Node>;
    _activeConnections: Map<string, Connection>;
    _nodesThatSuppliedPeerList: Set<Node>;
    _keyPair: StellarBase.Keypair;
    _usePublicNetwork: boolean;
    _quorumSetHashes: Map<string, Set<string>>;
    _connectionManager: ConnectionManager;
    _resolve: (Array<Node>) => void;
    _reject: () => void;
    _durationInMilliseconds: number;
    _logger: any;

    constructor(usePublicNetwork: boolean = true, durationInMilliseconds: number = 30000, logger) { //todo report data with event listeners (e.g. connectionmanager)
        this._durationInMilliseconds = durationInMilliseconds;
        this._busyCounter = 0;
        this._allNodes = new Map();
        this._activeConnections = new Map(); //nodes that completed a handshake and we are currently listening to
        this._nodesThatSuppliedPeerList = new Set();
        this._keyPair = StellarBase.Keypair.random();
        this._usePublicNetwork = usePublicNetwork;
        this._quorumSetHashes = new Map();
        this._connectionManager = new ConnectionManager(
            this._usePublicNetwork,
            this.onHandshakeCompleted.bind(this),
            this.onPeersReceived.bind(this),
            this.onLoadTooHighReceived.bind(this),
            this.onQuorumSetHashDetected.bind(this),
            this.onQuorumSetReceived.bind(this),
            this.onNodeDisconnected.bind(this));
        if(!logger) {
            this.initializeDefaultLogger();
        } else {
            this._logger = logger;
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
    crawl(nodesSeed: Array<Node>) {
        this._logger.log('info',"[CRAWLER] Starting crawl with seed of " + nodesSeed.length + "nodes.");
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
            this._logger.log('debug','[CRAWLER] ' + node.key + ': Node key already used for crawl');
            return;
        }

        this._allNodes.set(node.key, node);
        this._busyCounter++;

        setTimeout(this.crawlNodeDelayed.bind(this), (this._allNodes.size %30)* 1000, node);
        //time to complete handshake rises with number of simultaneous connections, so we batch crawls over 30 seconds
        //todo better solution as number of nodes will grow
    }

    crawlNodeDelayed(node: Node) {
        this._logger.log('debug','[CRAWLER] ' + node.key + ': Start Crawl');

        try {
            this._connectionManager.connect(
                this._keyPair,
                node,
                this._durationInMilliseconds
            );
        } catch (exception) {
            this._logger.log('error','[CRAWLER] ' + node.key + ': Exception: ' + exception.message);
        }
    }

    wrapUp(node: Node) {
        if (this._activeConnections.has(node.key)) {
            this._activeConnections.delete(node.key);
        }

        CrawlStatisticsProcessor.updateNodeStatistics(node);

        this._busyCounter--;
        this._logger.log('debug',"[CRAWLER] Connected to " + this._busyCounter + " nodes.");
        if (this._busyCounter === 0) {


            this._logger.log('info',"[CRAWLER] Finished with all nodes");
            this._logger.log('info','[CRAWLER] ' + this._allNodes.size + " nodes crawled of which are active: " + Array.from(this._allNodes.values()).filter(node => node.active).length);
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
            this._logger.log('debug','[CRAWLER] ' + connection.toNode.key + ': Node disconnected');
            this.wrapUp(connection.toNode);
        } catch (exception) {
            this._logger.log('error','[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    onHandshakeCompleted(connection: Connection) {
        try {
            this._logger.log('debug','[CRAWLER] ' + connection.toNode.key + ': Handshake succeeded, marking toNode as active');
            //filter out nodes that switched ip address //@todo: correct location?
            [...this._allNodes.values()].forEach(node => {
                if (node.publicKey === undefined || node.publicKey === null) {
                    return;
                }
                if (node.publicKey === connection.toNode.publicKey && node.key !== connection.toNode.key) {
                    this._logger.log('debug','[CRAWLER] ' + connection.toNode.key + ': toNode switched ip, discard the old one.');
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
            this._logger.log('error','[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    onPeersReceived(peers:Array<Node>, connection:Connection) {
        try {
            this._logger.log('debug','[CRAWLER] ' + connection.toNode.key + ': ' + peers.length + ' peers received');
            this._nodesThatSuppliedPeerList.add(connection.toNode);
            peers.forEach(peer => {
                if(!this._allNodes.has(peer.key)) { //newly discovered toNode
                    this._logger.log('debug','[CRAWLER] ' + connection.toNode.key + ': supplied a newly discovered peer: ' + peer.key);
                    this.crawlNode(peer);
                } else {
                    this._logger.log('debug','[CRAWLER] peer ' + peer.key + ' already crawled');
                }
            });
        } catch (exception) {
            this._logger.log('error','[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }

    }

    onLoadTooHighReceived(connection: Connection) {
        try {
            this._logger.log('debug','[CRAWLER] ' + connection.toNode.key + ': Load too high');
        } catch (exception) {
            this._logger.log('error','[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    onQuorumSetHashDetected(connection: Connection, quorumSetHash: string, quorumSetOwnerPublicKey: string) {
        try {
            this._logger.log('debug','[CRAWLER] ' + connection.toNode.key + ': Detected quorumSetHash: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);

            let node = null;
            let nodes = [...this._allNodes.values()].filter(node => node.publicKey === quorumSetOwnerPublicKey);
            if (nodes.length > 0) {
                node = nodes[0];
            } else {
                this._logger.log('debug','[CRAWLER] ' + connection.toNode.key + ': Quorumset owner unknown to us, skipping: ' + quorumSetOwnerPublicKey);
                return;
            }

            if (node.quorumSet.hashKey === quorumSetHash) {
                this._logger.log('debug','[CRAWLER] ' + connection.toNode.key + ': Quorumset already known to us for toNode: ' + quorumSetOwnerPublicKey);
            } else {
                this._logger.log('debug','[CRAWLER] ' + connection.toNode.key + ': Unknown or modified quorumSetHash for toNode, requesting it: ' + quorumSetOwnerPublicKey);
                let owners = this._quorumSetHashes.get(quorumSetHash);
                if (owners) {
                    if (owners.has(quorumSetOwnerPublicKey)) {
                        this._logger.log('debug','[CRAWLER] ' + connection.toNode.key + ': Already logged quorumSetHash for owner: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);
                    } else {
                        owners.add(quorumSetOwnerPublicKey);
                        this._logger.log('debug','[CRAWLER] ' + connection.toNode.key + ': Logged new owner for quorumSetHash: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);
                    }
                } else {
                    this._quorumSetHashes.set(quorumSetHash, new Set([quorumSetOwnerPublicKey]));
                }
                this.requestQuorumSetFromConnectedNodes(quorumSetHash, quorumSetOwnerPublicKey);
            }
        } catch (exception) {
            this._logger.log('error','[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    onQuorumSetReceived(connection: Connection, quorumSet: QuorumSet) {
        try {
            this._logger.log('debug','[CRAWLER] ' + connection.toNode.key + ': QuorumSet received: ' + quorumSet.hashKey);
            let owners = this._quorumSetHashes.get(quorumSet.hashKey);
            if (!owners) {
                return;
            }
            owners.forEach(nodePublicKey => {
                let nodes = [...this._allNodes.values()].filter(node => node.publicKey === nodePublicKey).forEach( //node could have switched ip, and thus it is now twice in the list with the same public key.
                    nodeWithNewQuorumSet => {
                        this._logger.log('debug','[CRAWLER] Updating QuorumSet for toNode: ' + nodeWithNewQuorumSet.publicKey + ' => ' + quorumSet.hashKey);
                        nodeWithNewQuorumSet.quorumSet = quorumSet;
                    }
                );
            });
        } catch (exception) {
            this._logger.log('error','[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }
}

module.exports = Crawler;