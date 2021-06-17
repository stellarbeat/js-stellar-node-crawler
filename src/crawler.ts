import {Connection, ConnectionManager} from "@stellarbeat/js-stellar-node-connector";
import {Node, QuorumSet} from '@stellarbeat/js-stellar-domain';
import * as EventSource from 'eventsource';
import axios from 'axios';

const StellarBase = require('stellar-base');
import * as winston from 'winston';
import {PeerNode} from "@stellarbeat/js-stellar-node-connector/lib";

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
    _allPeerNodes: Map<string, PeerNode>;
    _activeConnections: Map<string, Connection>;
    _processedValidatingNodes: Set<PublicKey> = new Set();
    _nodesThatSuppliedPeerList: Set<PeerNode>;
    _keyPair: any /*StellarBase.Keypair*/;
    _usePublicNetwork: boolean;
    _quorumSetHashes: Map<string, Set<string>>;
    _connectionManager: ConnectionManager;
    _resolve: any; //todo typehints
    _reject: any;
    _durationInMilliseconds: number;
    _logger: any;
    _ledgerSequence: LedgerSequence = 0;
    _processedLedgers: Set<number> = new Set();
    _nodesToCrawl: Array<PeerNode>;
    _weight: number;
    _maxWeight: number;
    _activeNodeWeight: number;
    _defaultNodeWeight: number;
    _publicKeyToNodeMap: Map<PublicKey, Node> = new Map<PublicKey, Node>();
    _timeouts: Map<string, any> = new Map();
    _peerNodesParticipatingInSCP: Set<string> = new Set();
    _prioritizedPeerNodes: Set<string> = new Set();
    _nodesActiveInLastCrawl: Set<PublicKey> = new Set();
    _pass:number = 1;

    public horizonLatestLedger:number = 0;
    /**
     * TODO:
     * - refactor out the Node dependency. Crawler should receive and return Peernodes.
     * - Add validating, active, overloaded properties to peernode and default to false.
     * - to prioritize previously active nodes in the crawl process, we need a 'priority' flag, currently this is 'activeInLastCrawl', do we switch this?
     * Todo: watch out for nodes that switch publickeys on the same IP. These are multiple Nodes, but in the current implementation of the crawler, they are only one peer node
     **/

    constructor(usePublicNetwork: boolean = true, durationInMilliseconds: number = 30000, logger: any = null) {
        if (!process.env.HORIZON_URL) {
            throw new Error('Horizon not configured');
        }
        this._durationInMilliseconds = durationInMilliseconds;
        this._busyCounter = 0;
        this._allPeerNodes = new Map();
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

    protected async getLatestLedger() {//todo: refactor out horizon to higher layer
        if(!process.env.HORIZON_URL)
            throw new Error('HORIZON URL env not configured');
        try {
            let result = await axios.get(process.env.HORIZON_URL);
            if(result && result.data && result.data.core_latest_ledger) {
                if(this.horizonLatestLedger !== result.data.core_latest_ledger){//horizon has a new ledger
                    this.horizonLatestLedger = result.data.core_latest_ledger;
                    this._ledgerSequence = result.data.core_latest_ledger;
                } else {
                    this._logger.log('warn', "[CRAWLER] horizon latest ledger not updated: " + result.data.core_latest_ledger + "Network halted? Trying out next ledger");
                    this._ledgerSequence ++;
                }
            } else {
                this._ledgerSequence ++;
                this._logger.log('error', "[CRAWLER] Could not fetch latest ledger from horizon, using next ledger as fallback " + this._ledgerSequence);
            }
        } catch (e) {
            this._ledgerSequence ++;
            this._logger.log('error', "Error fetching latest ledger from horizon, using next ledger as fallback " + e.message);
        }
        this._logger.log('info', "[CRAWLER] Checking validating states based on latest ledger: " + this._ledgerSequence);
    }

    setLogger(logger: any) {
        this._logger = logger;
    }

    protected initializeDefaultLogger() {
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
     * @param nodesSeed
     * @param horizonLatestLedger too check if the ledger is advancing.
     */
    async crawl(nodesSeed: Array<Node>, horizonLatestLedger:number = 0): Promise<Array<Node>> {
        this._ledgerSequence = horizonLatestLedger;
        this._pass = 1;
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
                    nodesSeed.forEach(node => this.crawlNode(node));
                }
            }
        );
    }

    crawlNode(node: Node) {
        if(node.active)
            this._nodesActiveInLastCrawl.add(node.publicKey);
        node.active = false;
        node.isValidating = false;
        node.overLoaded = false;

        let peerNode = new PeerNode(node.ip, node.port);
        peerNode.publicKey = node.publicKey;
        this.crawlPeerNode(peerNode);
    }

    protected crawlPeerNode(node: PeerNode) {
        if (this._allPeerNodes.has(node.key)) {
            this._logger.log('debug', '[CRAWLER] ' + node.key + ': Node key already used for crawl');
            return;
        }
        this._logger.log('debug', '[CRAWLER] ' + node.key + ': Adding node to crawl queue');
        this._allPeerNodes.set(node.key, node);
        this._nodesToCrawl.push(node);
        this._busyCounter++;

        this.processCrawlQueue();
    }

    protected addWeight(node: PeerNode) {
        if(node.publicKey
            &&  this._publicKeyToNodeMap.get(node.publicKey)
            && this._nodesActiveInLastCrawl.has(node.publicKey)){
            this._prioritizedPeerNodes.add(node.key);
            this._weight += this._activeNodeWeight;
        } //high chance that we can connect so we dedicate most resources to it
        else {
            this._weight += this._defaultNodeWeight;
        }
    }

    removeWeight(node: PeerNode) {
        if(this._prioritizedPeerNodes.has(node.key)){
            this._weight -= this._activeNodeWeight;
        }
        else {
            this._weight -= this._defaultNodeWeight;
        }
    }

    processCrawlQueue() {
        while (this._weight < this._maxWeight && this._nodesToCrawl.length > 0) {
            let nextNodeToCrawl = this._nodesToCrawl.shift()!;
            try {
                this.addWeight(nextNodeToCrawl);

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

    wrapUp(node: PeerNode) {
        if(this._timeouts.get(node.key))
            clearTimeout(this._timeouts.get(node.key));

        if (this._activeConnections.has(node.key)) {
            this._activeConnections.delete(node.key);
        }

        this.removeWeight(node);

        this._busyCounter--;
        this._logger.log('debug', "[CRAWLER] Processing " + this._busyCounter + " nodes.");

        this.processCrawlQueue();

        if (this._busyCounter === 0) {//stop the crawler
            let validatorsToRetry:Node[] = [];
            if(this._pass === 1){
                this._pass++;
                validatorsToRetry = Array.from(this._publicKeyToNodeMap.values())
                    .filter(node => node.active && node.isValidator && !node.isValidating);
                validatorsToRetry
                    .forEach(validator => {
                        this._logger.log('info', "[CRAWLER] retrying: " + validator.publicKey);
                        let peerNode = this._allPeerNodes.get(validator.key);
                        if(!peerNode)
                            return;
                        this._allPeerNodes.delete(validator.key);
                        this.crawlPeerNode(peerNode);
                    })
            }

            if(validatorsToRetry.length === 0){
                this._logger.log('info', "[CRAWLER] Finished with all nodes");
                this._logger.log('info', '[CRAWLER] ' + this._allPeerNodes.size + " nodes crawled of which are active: " + Array.from(this._publicKeyToNodeMap.values()).filter(node => node.active).length);
                this._logger.log('info', '[CRAWLER] of which are validating: '  + Array.from(this._publicKeyToNodeMap.values()).filter(node => node.isValidating).length);
                this._logger.log('info', '[CRAWLER] of which are overloaded: '  + Array.from(this._publicKeyToNodeMap.values()).filter(node => node.overLoaded).length);
                this._logger.log('info', '[CRAWLER] ' + this._nodesThatSuppliedPeerList.size + " supplied us with a peers list.");

                this._resolve(
                    Array.from(this._publicKeyToNodeMap.values())
                );
            }
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
            if(connection.toNode.publicKey && this._processedValidatingNodes.has(connection.toNode.publicKey)){ //if a node cant complete the handshake, but it is confirmed through other nodes that it is active and validating, we mark it as such.
                let node = this._publicKeyToNodeMap.get(connection.toNode.publicKey);
                if(node && !node.active) {
                    this._logger.log('info', '[CRAWLER] ' + connection.toNode.key + ': Node did not complete handshake, but is confirmed validating. Marking node as overloaded and validating.');
                    node.overLoaded = true;
                    node.active = true;
                    node.isValidating = true;
                } //node didn't complete handshake, but it is confirmed validating and thus active. This happens when the node has a high load and can't process messages quickly enough.
            }
            this.wrapUp(connection.toNode);
        } catch (exception) {
            this._logger.log('error', '[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    onHandshakeCompleted(connection: Connection) {
        try {
            this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Handshake succeeded, marking ' + connection.toNode.publicKey + ' as active');
            if(!connection.toNode.publicKey)
                throw new Error('peernode missing publickey: ' + connection.toNode.key);

            let node = this._publicKeyToNodeMap.get(connection.toNode.publicKey);
            if(!node) {
                node = new Node(connection.toNode.publicKey, connection.toNode.ip, connection.toNode.port);
                this._publicKeyToNodeMap.set(node.publicKey, node);
            }
            node.active = true;
            if(node.ip !== connection.toNode.ip) {
                this._logger.log('info', '[CRAWLER] ' + connection.toNode.key + ': ' + connection.toNode.publicKey + ' switched IP');
            }
            node.ip = connection.toNode.ip;
            node.port = connection.toNode.port;
            node.ledgerVersion = connection.toNode.ledgerVersion;
            node.overlayVersion = connection.toNode.overlayVersion;
            node.overlayMinVersion = connection.toNode.overlayMinVersion;
            node.networkId = connection.toNode.networkId;
            node.versionStr = connection.toNode.versionStr;

            this._activeConnections.set(connection.toNode.key, connection);
            /*if (!this._nodesThatSuppliedPeerList.has(connection.toNode)) { //Most nodes send their peers automatically on successful handshake
                this._connectionManager.sendGetPeers(connection);
            }*/
            if(this._processedValidatingNodes.has(node.publicKey)) { //we already confirmed that the node is validating by listening to externalize messages propagated by other nodes.
                this._logger.log('info', '[CRAWLER] ' + connection.toNode.key + ': ' + connection.toNode.publicKey + ' already confirmed validating, disconnecting');
                node.isValidating = true;
                this._connectionManager.disconnect(connection);
            } else {
                this.setSCPTimeout(node);
                this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': send get scp status message');
                this._connectionManager.sendGetScpStatus(connection, this._ledgerSequence)
            }
        } catch (exception) {
            this._logger.log('error', '[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    onPeersReceived(peers: Array<PeerNode>, connection: Connection) {
        try {
            this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': ' + peers.length + ' peers received');
            this._nodesThatSuppliedPeerList.add(connection.toNode);
            peers.forEach(peer => {
                if (!this._allPeerNodes.has(peer.key)) { //newly discovered toNode
                    this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': supplied a newly discovered peer: ' + peer.key);
                    this.crawlPeerNode(peer);
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
            this._logger.log('info', '[CRAWLER] ' + connection.toNode.key + ': Load too high message received, disconnected');
            if(connection.toNode.publicKey){
                let node = this._publicKeyToNodeMap.get(connection.toNode.publicKey);
                if(node) {
                    node.active = true;
                    node.overLoaded = true;
                }
            }
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
            this._peerNodesParticipatingInSCP.add(node.key);
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
                if(node.active)//we have successfully connected to node already, so we mark it as validating
                {
                    if(!node.isValidating) { //first time validating is detected
                        this._logger.log('info', '[CRAWLER] ' + node.key + ': Node is validating on ledger:  ' + scpStatement.slotIndex);
                        node.isValidating = true;
                    }
                }
            } else {
                this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Quorumset owner unknown to us, skipping: ' + quorumSetOwnerPublicKey);
                return;
            }

            if (node.quorumSet.hashKey === quorumSetHash) {
                this._logger.log('debug', '[CRAWLER] ' + connection.toNode.key + ': Quorumset already known to us for toNode: ' + quorumSetOwnerPublicKey);
                //we don't need any more info for this node, fully processed
                this._processedValidatingNodes.add(node.publicKey); //node is confirmed validating and we have the quorumset. If we connect to it in the future, we can disconnect immediately and mark it as validating.
            } else {
                this._logger.log('info', '[CRAWLER] ' + connection.toNode.key + ': Unknown or modified quorumSetHash for toNode, requesting it: ' + quorumSetOwnerPublicKey + ' => ' + quorumSetHash);
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
            this._logger.log('info', '[CRAWLER] ' + connection.toNode.key + ': QuorumSet received: ' + quorumSet.hashKey);
            if(!quorumSet.hashKey)
                throw new Error('Missing hashkey for quorumset');
            let owners = this._quorumSetHashes.get(quorumSet.hashKey);
            if (!owners) {
                return;
            }
            owners.forEach(owner => {
                    let nodeWithNewQuorumSet = this._publicKeyToNodeMap.get(owner);
                    if(!nodeWithNewQuorumSet)
                        return;

                    if (nodeWithNewQuorumSet.quorumSet.hashKey === quorumSet.hashKey) {
                        this._logger.log('debug', '[CRAWLER] QuorumSet already updated for toNode: ' + nodeWithNewQuorumSet.publicKey + ' => ' + quorumSet.hashKey);

                    } else {
                        this._logger.log('debug', '[CRAWLER] Updating QuorumSet for toNode: ' + nodeWithNewQuorumSet.publicKey + ' => ' + quorumSet.hashKey);
                        this._processedValidatingNodes.add(owner); //the node is validating because we only request quorumSets from externalize messages.

                        nodeWithNewQuorumSet.quorumSet = quorumSet;
                    }
            });
        } catch (exception) {
            this._logger.log('error', '[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    setSCPTimeout(peerNode:PeerNode) {
        this._timeouts.set(peerNode.key, setTimeout(() => {
            this._logger.log('info','[CRAWLER] ' + peerNode.key + ': SCP Listen timeout reached, disconnecting');
            if(!peerNode.publicKey)
                throw new Error('peernode is missing publickey: ' + peerNode.key);

            let node = this._publicKeyToNodeMap.get(peerNode.publicKey);
            if(this._peerNodesParticipatingInSCP.has(peerNode.key) && node && !node.isValidating){ //if two peernodes are reusing the same publicKey, we can't tell which one is (not) validating, because scp messages are based on publickey, not ip.
                this._peerNodesParticipatingInSCP.delete(node.key);
                this._logger.log('info','[CRAWLER] ' + node.key + ': Node was active in SCP, adding more time to listen for externalize messages');
                this.setSCPTimeout(node);
            } else {
                let connection = this._activeConnections.get(peerNode.key);
                if(connection)
                    this._connectionManager.disconnect(connection);
            }
        }, 3000)); //3 seconds to provide first scp message
    }
}