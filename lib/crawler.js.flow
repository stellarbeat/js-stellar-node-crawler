// @flow
const Connection = require("@stellarbeat/js-stellar-node-connector").Connection;
const Node = require('@stellarbeat/js-stellar-domain').Node;
const QuorumSet = require('@stellarbeat/js-stellar-domain').QuorumSet;
const ConnectionManager = require("@stellarbeat/js-stellar-node-connector").ConnectionManager;
const StellarBase = require('stellar-base');

class Crawler {

    _busyCounter: number;
    _allNodes: Map<string,Node>;
    _nodesWithPublicKeys: Map<string, Node>;
    _activeNodes: Set<Node>;
    _activeConnections: Map<string, Connection>;
    _nodesThatSuppliedPeerList: Set<Node>;
    _keyPair: StellarBase.Keypair;
    _usePublicNetwork: boolean;
    _quorumSetHashes: Map<string, Set<string>>;
    _connectionManager: ConnectionManager;
    _resolve: (Array<Node>)=>void;
    _reject: ()=>void;
    _durationInMilliseconds: number;

    constructor(usePublicNetwork:boolean = true, durationInMilliseconds:number = 30000) { //todo report data with event listeners (e.g. connectionmanager)
        this._durationInMilliseconds = durationInMilliseconds;
        this._busyCounter = 0;
        this._allNodes = new Map();
        this._nodesWithPublicKeys = new Map();
        this._activeNodes = new Set();
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
    }

    /**
     *
     * @param nodesSeed
     * @returns {Promise<any>}
     */
    crawl(nodesSeed: Array<Node>) {
        return new Promise((resolve, reject) => {
                this._resolve = resolve;
                this._reject = reject;

                nodesSeed.forEach( node => {
                        this.crawlNode(node);
                    }
                );
            }
        );
    }

    crawlNode(node:Node, durationInMilliseconds:number = 30000) {

        if(this._allNodes.has(node.key)) {
            console.log('[CRAWLER] ' + node.key + ': Node key already used for crawl');
            return;
        }

        this._allNodes.set(node.key, node);

        console.log('[CRAWLER] ' + node.key + ': Start Crawl');
        this._busyCounter ++;

        try {
            console.time(node.key);
            this._connectionManager.connect(
                this._keyPair,
                node,
                this._durationInMilliseconds
            );
        } catch (exception) {
            console.log('[CRAWLER] ' + node.key + ': Exception: ' + exception.message);
        }
    }

    wrapUp(node:Node)
    {
        console.timeEnd(node.key);
        if(this._activeConnections.has(node.key)) {
            this._activeConnections.delete(node.key);
        }

        this._busyCounter --;
        console.log("[CRAWLER] Connected to " + this._busyCounter + " nodes.");
        if(this._busyCounter === 0 ) {
            console.log("[CRAWLER] Finished with all nodes");
            console.log('[CRAWLER] ' + this._allNodes.size + " nodes crawled of which are active: " + this._activeNodes.size);
            console.log('[CRAWLER] ' + this._nodesThatSuppliedPeerList.size + " supplied us with a peers list.");

            this._resolve(
                Array.from(this._allNodes.values())
            );
        }
    }

    requestQuorumSetFromConnectedNodes(quorumSetHash:string, quorumSetOwnerPublicKey:string){
        let isSent = false;
        //send to owner
        this._activeConnections.forEach( connection => {
                if(connection.toNode.publicKey === quorumSetOwnerPublicKey) {
                    this._connectionManager.sendGetQuorumSet(Buffer.from(quorumSetHash, 'base64'), connection);
                    isSent = true;
                }
            }
        );

        if(isSent) {
            return;
        }

        //if we are not connected to the owner, send a request to everyone
        this._activeConnections.forEach( connection => {
                this._connectionManager.sendGetQuorumSet(Buffer.from(quorumSetHash, 'base64'), connection);
            }
        );
    }

    /*
    * CONNECTION EVENT LISTENERS
     */
    onNodeDisconnected(connection: Connection) {
        try {
            console.log('[CRAWLER] ' + connection.toNode.key + ': Node disconnected');
            this.wrapUp(connection.toNode);
        } catch (exception) {
            console.log('[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    onHandshakeCompleted(connection: Connection) {
        try {
            console.log('[CRAWLER] ' + connection.toNode.key + ': Handshake succeeded, marking toNode as active');
            //filter out nodes that switched ip address //@todo: correct location?
            [...this._allNodes.values()].forEach(node => {
                if(node.publicKey === undefined || node.publicKey === null) {
                    return;
                }
                if(node.publicKey === connection.toNode.publicKey && node.key !== connection.toNode.key) {
                    console.log('[CRAWLER] ' + connection.toNode.key + ': toNode switched ip, discard the old one.');
                    console.log(node);
                    this._allNodes.delete(node.key);
                }
            });
            this._activeNodes.add(connection.toNode);
            let publicKey = connection.toNode.publicKey;
            if(!publicKey) {
                throw new Error('hello message did not supply public key');
            }
            this._nodesWithPublicKeys.set(publicKey, connection.toNode);
            this._activeConnections.set(connection.toNode.key, connection);
            if(!this._nodesThatSuppliedPeerList.has(connection.toNode)) {
                this._connectionManager.sendGetPeers(connection);
            }
        } catch (exception) {
            console.log('[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    onPeersReceived(peers:Array<Node>, connection:Connection) {
        try {
            console.log('[CRAWLER] ' + connection.toNode.key + ': ' + peers.length + ' peers received');
            this._nodesThatSuppliedPeerList.add(connection.toNode);
            peers.forEach(peer => {
                if(!this._allNodes.has(peer.key)) { //newly discovered toNode
                    console.log('[CRAWLER] ' + connection.toNode.key + ': supplied a newly discovered peer: ' + peer.key);
                    this.crawlNode(peer);
                }
            });
        } catch (exception) {
            console.log('[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }

    }

    onLoadTooHighReceived(connection:Connection) {
        try {
            console.log('[CRAWLER] ' + connection.toNode.key + ': Load too high, but marking as active');
            this._activeNodes.add(connection.toNode);
            this._activeConnections.delete(connection.toNode.key);
        } catch (exception) {
            console.log('[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    onQuorumSetHashDetected(connection:Connection, quorumSetHash:string, quorumSetOwnerPublicKey:string) {
        try {
            console.log('[CRAWLER] ' + connection.toNode.key + ': Detected quorumSetHash: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);

            let node = this._nodesWithPublicKeys.get(quorumSetOwnerPublicKey);
            if(node === undefined || node === null) {
                let nodes = [...this._allNodes.values()].filter(node => node.publicKey === quorumSetOwnerPublicKey);
                if(nodes.length > 0) {
                    node = nodes[0];
                } else {
                    console.log('[CRAWLER] ' + connection.toNode.key + ': Quorumset owner unknown to us, skipping: ' + quorumSetOwnerPublicKey);
                    return;
                }
            }
            console.log('[CRAWLER] ' + connection.toNode.key + ': Marking owner as active: ' + quorumSetOwnerPublicKey);
            this._activeNodes.add(node);

            if(node.quorumSet !== undefined && node.quorumSet !== null && node.quorumSet.hashKey === quorumSetHash) {
                console.log('[CRAWLER] ' + connection.toNode.key + ': Quorumset already known to us for toNode: ' + quorumSetOwnerPublicKey);
            } else {
                console.log('[CRAWLER] ' + connection.toNode.key + ': Unknown quorumSetHash for toNode, requesting it: ' + quorumSetOwnerPublicKey);
                let owners = this._quorumSetHashes.get(quorumSetHash);
                if(owners) {
                    if(owners.has(quorumSetOwnerPublicKey)){
                        console.log('[CRAWLER] ' + connection.toNode.key + ': Already logged quorumSetHash for owner: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);
                    } else {
                        owners.add(quorumSetOwnerPublicKey);
                        console.log('[CRAWLER] ' + connection.toNode.key + ': Logged new owner for quorumSetHash: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);
                    }
                } else {
                    this._quorumSetHashes.set(quorumSetHash, new Set([quorumSetOwnerPublicKey]));
                }
                this.requestQuorumSetFromConnectedNodes(quorumSetHash, quorumSetOwnerPublicKey);
            }
        } catch (exception) {
            console.log('[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }

    onQuorumSetReceived(connection:Connection, quorumSet:QuorumSet) {
        try {
            console.log('[CRAWLER] ' + connection.toNode.key + ': QuorumSet received: ' + quorumSet.hashKey);
            let owners = this._quorumSetHashes.get(quorumSet.hashKey);
            if(!owners){
                return;
            }
            owners.forEach(nodePublicKey => {
                let nodes = [...this._allNodes.values()].filter(node => node.publicKey === nodePublicKey);
                if(nodes.length === 0) {
                    console.log('[CRAWLER] received quorumset for unknown user. We did not request this: ' + nodePublicKey);
                    return;
                }
                let node = nodes[0];
                if(node.publicKey) {
                    console.log('[CRAWLER] Updating QuorumSet for toNode: ' + node.publicKey + ' => ' + quorumSet.hashKey);
                    node.quorumSet = quorumSet;
                }
            });
        } catch (exception) {
            console.log('[CRAWLER] ' + connection.toNode.key + ': Exception: ' + exception.message);
        }
    }
}

module.exports = Crawler;