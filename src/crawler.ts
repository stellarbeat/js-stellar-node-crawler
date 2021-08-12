import {Node, QuorumSet} from '@stellarbeat/js-stellar-domain';
import axios from 'axios';
import {AsyncPriorityQueue, AsyncResultCallback, priorityQueue} from 'async';

import {
    PeerNode,
    Connection,
    ConnectionManager,
    getConfigFromEnv,
    getPublicKeyStringFromBuffer,
    getIpFromPeerAddress
} from "@stellarbeat/js-stellar-node-connector";

import {hash, Networks, xdr} from "stellar-base";
import LRUCache = require("lru-cache");
import StellarMessage = xdr.StellarMessage;
import MessageType = xdr.MessageType;
import ScpStatement = xdr.ScpStatement;
import ScpStatementType = xdr.ScpStatementType;
import {verifySCPEnvelopeSignature} from "../../node-connector/src/stellar-message-service";

type PublicKey = string;
type LedgerSequence = number;

require('dotenv').config();

export class Crawler {
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
    protected crawlQueue: AsyncPriorityQueue<PeerNode>;
    protected publicKeypeerMap: Map<PublicKey, Node> = new Map<PublicKey, Node>();
    protected timeouts: Map<string, any> = new Map();
    protected peerNodesParticipatingInSCP: Set<string> = new Set();
    protected nodesActiveInLastCrawl: Set<PublicKey> = new Set();
    protected pass: number = 1;
    protected envelopeCache = new LRUCache(5000);

    public horizonLatestLedger: number = 0;

    //todo: network string instead of boolean
    constructor(usePublicNetwork: boolean = true, concurrency: number = 400, logger: any = null) {
        if (!process.env.HORIZON_URL) {
            throw new Error('Horizon not configured');
        }
        this.allPeerNodes = new Map();
        this.activeConnections = new Map(); //nodes that completed a handshake and we are currently listening to
        this.nodesThatSuppliedPeerList = new Set();
        this.usePublicNetwork = usePublicNetwork;
        this.quorumSetHashes = new Map();
        if (!logger) {
            logger = this.initializeDefaultLogger();
        }

        this.logger = logger.child({app: 'Crawler'});

        this.connectionManager = new ConnectionManager(
            this.usePublicNetwork,
            getConfigFromEnv(),
            logger
        );

        this.crawlQueue = priorityQueue(this.processPeerNode.bind(this), concurrency);
        this.crawlQueue.drain(this.wrapUp.bind(this));//when queue is empty, we wrap up the crawler
    }

    getProcessedLedgers() {
        return Array.from(this.processedLedgers);
    }

    protected async getLatestLedger() {//todo: refactor out horizon to higher layer
        if (!process.env.HORIZON_URL)
            throw new Error('HORIZON URL env not configured');
        try {
            let result = await axios.get(process.env.HORIZON_URL);
            if (result && result.data && result.data.core_latest_ledger) {
                if (this.horizonLatestLedger !== result.data.core_latest_ledger) {//horizon has a new ledger
                    this.horizonLatestLedger = result.data.core_latest_ledger;
                    this.ledgerSequence = result.data.core_latest_ledger;
                } else {
                    this.logger.warn("horizon latest ledger not updated: " + result.data.core_latest_ledger + "Network halted? Trying out next ledger");
                    this.ledgerSequence++;
                }
            } else {
                this.ledgerSequence++;
                this.logger.error("Could not fetch latest ledger from horizon, using next ledger as fallback " + this.ledgerSequence);
            }
        } catch (e) {
            this.ledgerSequence++;
            this.logger.error("Error fetching latest ledger from horizon, using next ledger as fallback " + e.message);
        }
        this.ledgerSequence++;
        this.logger.info("Checking validating states based on latest ledger: " + this.ledgerSequence);
    }

    setLogger(logger: any) {
        this.logger = logger;
    }

    protected initializeDefaultLogger() {
        return require('pino')({
            level: process.env.LOG_LEVEL || 'info',
            base: undefined,
        });
    }

    /**
     * @param nodesSeed
     * @param horizonLatestLedger too check if the ledger is advancing.
     */
    async crawl(nodesSeed: Array<Node>, horizonLatestLedger: number = 0): Promise<Array<Node>> {
        console.time("crawl");
        this.ledgerSequence = horizonLatestLedger;
        this.pass = 1;
        this.logger.info("Starting crawl with seed of " + nodesSeed.length + "nodes.");

        nodesSeed.forEach(node => this.publicKeypeerMap.set(node.publicKey, node));

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

        this.crawlPeerNode(peerNode, this.nodesActiveInLastCrawl.has(node.publicKey) ? 1 : 5);
    }

    protected crawlPeerNode(node: PeerNode, priority: number = 5) {
        if (this.allPeerNodes.has(node.key)) {
            this.logger.debug({'peer': node.key}, 'Node key already used for crawl');
            return;
        }
        this.logger.debug({'peer': node.key}, 'Adding node to crawl queue');
        this.allPeerNodes.set(node.key, node);
        this.crawlQueue.push([node], priority, (error) => {
            console.log(error)
        });
    }

    protected processPeerNode(peerNode: PeerNode, done: AsyncResultCallback<any>) {
        try {
            this.logger.info({'peer': peerNode.key}, 'Connecting');
            let connection = this.connectionManager.connect(
                peerNode.ip,
                peerNode.port
            );
            connection.on("connect", () => this.onConnected(connection));
            connection.on("error", (error: Error) => console.log(error));
            connection.on("data", (stellarMessage: StellarMessage) => {
                if (stellarMessage.switch().value === MessageType.scpMessage().value) {
                    if (this.envelopeCache.has(stellarMessage.envelope().signature().toString())) {
                        return;
                    }
                    this.envelopeCache.set(stellarMessage.envelope().signature().toString(), 1);
                    //@ts-ignore
                    if (verifySCPEnvelopeSignature(stellarMessage.envelope(), hash(Networks.PUBLIC)))
                        this.onSCPStatementReceived(connection, stellarMessage.envelope().statement())
                    else
                        connection.destroy(new Error("Invalid SCP Signature")); //nodes should not forward invalid messages
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
            connection.on("close", () => this.onNodeDisconnected(connection, done));
        } catch (error) {
            this.logger.error({'peer': peerNode.key}, error.message);
        }
    }

    protected wrapUp() {
        this.logger.info("processed all items in queue");
        let validatorsToRetry: Node[] = [];
        if (this.pass === 1) {
            this.pass++;
            validatorsToRetry = Array.from(this.publicKeypeerMap.values())
                .filter(node => node.active && node.isValidator && !node.isValidating);
            validatorsToRetry
                .forEach(validator => {
                    this.logger.info("retrying: " + validator.publicKey);
                    let peerNode = this.allPeerNodes.get(validator.key);
                    if (!peerNode)
                        return;
                    this.allPeerNodes.delete(validator.key);
                    this.crawlPeerNode(peerNode);
                })
        }

        if (validatorsToRetry.length === 0) {
            this.logger.info("Finished with all nodes");
            this.logger.info(this.allPeerNodes.size + " nodes crawled of which are active: " + Array.from(this.publicKeypeerMap.values()).filter(node => node.active).length);
            this.logger.info('of which are validating: ' + Array.from(this.publicKeypeerMap.values()).filter(node => node.isValidating).length);
            this.logger.info('of which are overloaded: ' + Array.from(this.publicKeypeerMap.values()).filter(node => node.overLoaded).length);
            this.logger.info(this.nodesThatSuppliedPeerList.size + " supplied us with a peers list.");

            console.timeEnd("crawl")

            this.resolve(
                Array.from(this.publicKeypeerMap.values())
            );
        }
    }

    protected requestQuorumSetFromConnectedNodes(quorumSetHash: string, quorumSetOwnerPublicKey: string) {
        let isSent = false;
        //send to owner
        this.activeConnections.forEach(connection => {
                if (connection.peer!.publicKey === quorumSetOwnerPublicKey) {
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
    protected onNodeDisconnected(connection: Connection, done: AsyncResultCallback<any>) {
        try {
            this.logger.info({'peer': connection.peer.key}, 'Node disconnected');
            if (connection.peer.publicKey && this.processedValidatingNodes.has(connection.peer.publicKey)) { //if a node cant complete the handshake, but it is confirmed through other nodes that it is active and validating, we mark it as such.
                let node = this.publicKeypeerMap.get(connection.peer.publicKey);
                if (node && !node.active) {
                    this.logger.debug({'peer': connection.peer.key}, 'Could not connect to node, but is confirmed validating. Marking node as overloaded and validating.'); //todo: way to go?
                    node.overLoaded = true;
                    node.active = true;
                    node.isValidating = true;
                } //node didn't complete handshake, but it is confirmed validating and thus active. This happens when the node has a high load and can't process messages quickly enough.
            }
            if (this.timeouts.get(connection.peer.key))
                clearTimeout(this.timeouts.get(connection.peer.key));

            if (this.activeConnections.has(connection.peer.key)) {
                this.activeConnections.delete(connection.peer.key);
            }

            this.logger.debug("nodes left in queue: " + this.crawlQueue.length());
            done();//done processing
        } catch (error) {
            this.logger.error({'peer': connection.peer.key}, 'Exception: ' + error.message);
            done(error)
        }
    }

    protected onConnected(connection: Connection) {
        try {
            this.logger.info({'peer': connection.peer.key, 'pk': connection.peer.publicKey}, 'Connected');
            if (!connection.peer.publicKey)
                throw new Error('peernode missing publickey: ' + connection.peer.key);

            let node = this.publicKeypeerMap.get(connection.peer.publicKey);
            if (!node) {
                node = new Node(connection.peer.publicKey, connection.peer.ip, connection.peer.port);
                this.publicKeypeerMap.set(node.publicKey, node);
            }
            node.active = true;
            if (node.ip !== connection.peer.ip) {
                this.logger.info({'peer': connection.peer.key}, ': ' + connection.peer.publicKey + ' switched IP');
            }
            node.ip = connection.peer.ip;
            node.port = connection.peer.port;
            node.ledgerVersion = connection.peer.ledgerVersion;
            node.overlayVersion = connection.peer.overlayVersion;
            node.overlayMinVersion = connection.peer.overlayMinVersion;
            node.networkId = connection.peer.networkId;
            node.versionStr = connection.peer.versionStr;

            this.activeConnections.set(connection.peer.key, connection);
            /*if (!this._nodesThatSuppliedPeerList.has(connection.peer)) { //Most nodes send their peers automatically on successful handshake
                this._connectionManager.sendGetPeers(connection);
            }*/
            if (this.processedValidatingNodes.has(node.publicKey)) { //we already confirmed that the node is validating by listening to externalize messages propagated by other nodes.
                this.logger.debug({'peer': connection.peer.key}, ': ' + connection.peer.publicKey + ' already confirmed validating, disconnecting');
                node.isValidating = true;
                this.logger.info({'peer': connection.peer.key, 'pk': connection.peer.publicKey}, 'Validating');
                connection.destroy();
            } else {
                this.setSCPTimeout(connection.peer);
                this.logger.debug({'peer': connection.peer.key}, ': send get scp status message');
                connection.sendStellarMessage(StellarMessage.getScpState(0));//a peernode can ignore this message when it has a high load.
                //this._connectionManager.sendGetScpStatus(connection, this._ledgerSequence)
            }
        } catch (error) {
            this.logger.error({'peer': connection.peer.key}, error.message);
        }
    }

    protected onPeersReceived(peers: Array<PeerNode>, connection: Connection) {
        try {
            this.logger.debug({'peer': connection.peer.key}, peers.length + ' peers received');
            this.nodesThatSuppliedPeerList.add(connection.peer);
            peers.forEach(peer => {
                if (!this.allPeerNodes.has(peer.key)) { //newly discovered peer
                    this.logger.debug({'peer': connection.peer.key}, 'supplied a newly discovered peer: ' + peer.key);
                    this.crawlPeerNode(peer);
                } else {
                    this.logger.debug('peer ' + peer.key + ' already crawled');
                }
            });
        } catch (error) {
            this.logger.error({'peer': connection.peer.key}, error.message);
        }

    }

    protected onLoadTooHighReceived(connection: Connection) {
        try {
            this.logger.info({'peer': connection.peer.key}, 'Load too high message received');
            if (connection.peer.publicKey) {
                let node = this.publicKeypeerMap.get(connection.peer.publicKey);
                if (node) {
                    node.active = true;
                    node.overLoaded = true;
                }
            }
        } catch (error) {
            this.logger.error({'peer': connection.peer.key}, error.message);
        }
    }

    protected onSCPStatementReceived(connection: Connection, scpStatement: ScpStatement) {

        let publicKey = getPublicKeyStringFromBuffer(scpStatement.nodeId().value());
        this.logger.debug({'peer': connection.peer.key}, scpStatement.pledges().switch().name + " message found for node " + publicKey + " for ledger " + scpStatement.slotIndex.toString());

        if (Number(scpStatement.slotIndex) < this.ledgerSequence) {
            return; //older scp messages are ignored.
        }

        let node = this.publicKeypeerMap.get(publicKey);
        if (node) {
            this.peerNodesParticipatingInSCP.add(node.key);
        }

        if (scpStatement.pledges().switch().value !== ScpStatementType.scpStExternalize().value) { //only if node is externalizing, we mark the node as validating
            return;
        }

        this.logger.debug({'peer': connection.peer.key}, 'Externalize message found for ledger with sequence ' + scpStatement.slotIndex);
        this.logger.debug({'peer': connection.peer.key}, scpStatement.slotIndex + ': ' + scpStatement.nodeId + ': ' + scpStatement.pledges().externalize().commit().value);
        this.processedLedgers.add(Number(scpStatement.slotIndex)); // todo track values

        this.logger.debug({'peer': connection.peer.key}, scpStatement.nodeId + ' is validating on ledger:  ' + scpStatement.slotIndex);

        let quorumSetHash = scpStatement.pledges().externalize().commitQuorumSetHash().toString('base64');
        let quorumSetOwnerPublicKey = publicKey;

        try {
            this.logger.debug({'peer': connection.peer.key}, 'Detected quorumSetHash: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);

            if (node) {
                if (node.active)//we have successfully connected to node already, so we mark it as validating
                {
                    if (!node.isValidating && !this.processedValidatingNodes.has(node.publicKey)) { //first time validating is detected
                        this.logger.info({'peer': connection.peer.key, 'pk': connection.peer.publicKey}, 'Validating');
                        node.isValidating = true;
                    }
                }
            } else {
                this.logger.debug({'peer': connection.peer.key}, 'Quorumset owner unknown to us, skipping: ' + quorumSetOwnerPublicKey);
                return;
            }

            if (node.quorumSet.hashKey === quorumSetHash) {
                this.logger.debug({'peer': connection.peer.key}, 'Quorumset already known to us for peer: ' + quorumSetOwnerPublicKey);
                //we don't need any more info for this node, fully processed
                this.processedValidatingNodes.add(node.publicKey); //node is confirmed validating and we have the quorumset. If we connect to it in the future, we can disconnect immediately and mark it as validating.//todo: disconnect if currently connected?
            } else {
                this.logger.info({'peer': connection.peer.key}, 'Unknown or modified quorumSetHash for peer, requesting it: ' + quorumSetOwnerPublicKey + ' => ' + quorumSetHash);
                let owners = this.quorumSetHashes.get(quorumSetHash);
                if (owners) {
                    if (owners.has(quorumSetOwnerPublicKey)) {
                        this.logger.debug({'peer': connection.peer.key}, 'Already logged quorumSetHash for owner: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);
                    } else {
                        owners.add(quorumSetOwnerPublicKey);
                        this.logger.debug({'peer': connection.peer.key}, 'Logged new owner for quorumSetHash: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);
                    }
                } else {
                    this.quorumSetHashes.set(quorumSetHash, new Set([quorumSetOwnerPublicKey]));
                }
                this.logger.debug({'peer': connection.peer.key}, ': Requesting quorumset: ' + quorumSetHash);

                this.requestQuorumSetFromConnectedNodes(quorumSetHash, quorumSetOwnerPublicKey);
            }
        } catch (error) {
            this.logger.error({'peer': connection.peer.key}, error.message);
        }
    }

    protected onQuorumSetReceived(connection: Connection, quorumSet: QuorumSet) {
        try {
            this.logger.info({'peer': connection.peer.key}, 'QuorumSet received: ' + quorumSet.hashKey);
            if (!quorumSet.hashKey)
                throw new Error('Missing hashkey for quorumset');
            let owners = this.quorumSetHashes.get(quorumSet.hashKey);
            if (!owners) {
                return;
            }
            owners.forEach(owner => {
                let nodeWithNewQuorumSet = this.publicKeypeerMap.get(owner);
                if (!nodeWithNewQuorumSet)
                    return;

                if (nodeWithNewQuorumSet.quorumSet.hashKey === quorumSet.hashKey) {
                    this.logger.debug('QuorumSet already updated for peer: ' + nodeWithNewQuorumSet.publicKey + ' => ' + quorumSet.hashKey);

                } else {
                    this.logger.debug('Updating QuorumSet for peer: ' + nodeWithNewQuorumSet.publicKey + ' => ' + quorumSet.hashKey);
                    this.processedValidatingNodes.add(owner); //the node is validating because we only request quorumSets from externalize messages.

                    nodeWithNewQuorumSet.quorumSet = quorumSet;
                }
            });
        } catch (error) {
            this.logger.error({'peer': connection.peer.key}, error.message);
        }
    }

    protected setSCPTimeout(peerNode: PeerNode) {
        this.timeouts.set(peerNode.key, setTimeout(() => {
            this.logger.debug({'peer': peerNode.key}, 'SCP Listen timeout reached, disconnecting');
            if (!peerNode.publicKey)
                throw new Error('peernode is missing publickey: ' + peerNode.key);

            let node = this.publicKeypeerMap.get(peerNode.publicKey);
            if (this.peerNodesParticipatingInSCP.has(peerNode.key) && node && !node.isValidating) {
                //a node could be reusing it's publickey on multiple ip's and thus be mapped to multiple peerNodes
                this.peerNodesParticipatingInSCP.delete(node.key);
                this.logger.debug({'peer': peerNode.key}, 'Node was active in SCP, adding more time to listen for externalize messages');
                this.setSCPTimeout(peerNode);
            } else {
                let connection = this.activeConnections.get(peerNode.key);
                if (connection)
                    connection.destroy();
            }
        }, 5000)); //5 seconds for first scp message, correlated with Herder::EXP_LEDGER_TIMESPAN_SECONDS
    }
}