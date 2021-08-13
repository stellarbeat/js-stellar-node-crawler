import {QuorumSet} from '@stellarbeat/js-stellar-domain';
import axios from 'axios';
import {AsyncPriorityQueue, AsyncResultCallback, priorityQueue} from 'async';

import {
    Connection,
    Node as NetworkNode,
    getConfigFromEnv,
    getPublicKeyStringFromBuffer,
    getIpFromPeerAddress,
    verifySCPEnvelopeSignature
} from "@stellarbeat/js-stellar-node-connector";

import {hash, Networks, xdr} from "stellar-base";
import LRUCache = require("lru-cache");
import StellarMessage = xdr.StellarMessage;
import MessageType = xdr.MessageType;
import ScpStatement = xdr.ScpStatement;
import ScpStatementType = xdr.ScpStatementType;
import {PeerNode} from "./peer-node";
import {NodeInfo} from "@stellarbeat/js-stellar-node-connector/lib/node";
import * as P from "pino";

type PublicKey = string;
type LedgerSequence = number;

require('dotenv').config();

type QuorumSetHash = string;

export class Crawler {
    protected allPeerNodes: Map<string, PeerNode>;
    protected activeConnections: Map<string, Connection>;
    protected processedValidatingNodes: Set<PublicKey> = new Set();
    protected nodesThatSuppliedPeerList: Set<string>;
    protected usePublicNetwork: boolean;
    protected quorumSetOwners: Map<string, Set<string>>;
    protected quorumSetMap: Map<QuorumSetHash, QuorumSet> = new Map<QuorumSetHash, QuorumSet>();
    protected crawlerNode: NetworkNode;
    protected resolve: any; //todo typehints
    protected reject: any;
    protected logger: P.Logger;
    protected ledgerSequence: LedgerSequence = 0;
    protected processedLedgers: Set<number> = new Set();
    protected crawlQueue: AsyncPriorityQueue<PeerNode>;
    protected activePeerNodesInCurrentCrawlByPublicKey: Map<PublicKey, PeerNode> = new Map();
    protected timeouts: Map<string, any> = new Map();
    protected peerNodesParticipatingInSCP: Set<string> = new Set();
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
        this.quorumSetOwners = new Map();
        if (!logger) {
            logger = this.initializeDefaultLogger();
        }

        this.logger = logger.child({app: 'Crawler'});

        this.crawlerNode = new NetworkNode(
            this.usePublicNetwork,
            getConfigFromEnv(), //todo: inject crawler config (or maybe crawlerNode itself?);
            logger
        );

        this.crawlQueue = priorityQueue(this.processPeerNodeInCrawlQueue.bind(this), concurrency);
        this.crawlQueue.drain(this.wrapUp.bind(this));//when queue is empty, we wrap up the crawler
    }

    public getProcessedLedgers() {
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

    protected initializeDefaultLogger() {
        return P({
            level: process.env.LOG_LEVEL || 'info',
            base: undefined,
        });
    }

    async crawl(nodeAddresses: Array<[ip:string, port:number]>, quorumSetMap:Map<string, QuorumSet> = new Map<string, QuorumSet>(), horizonLatestLedger: number = 0): Promise<Array<PeerNode>> {
        console.time("crawl");
        this.ledgerSequence = horizonLatestLedger;
        this.quorumSetMap = quorumSetMap;
        this.logger.info("Starting crawl with seed of " + nodeAddresses.length + "addresses.");

        return await new Promise<Array<PeerNode>>(async (resolve, reject) => {
                this.resolve = resolve;
                this.reject = reject;

                try {
                    await this.getLatestLedger();
                } catch (e) {
                    this.reject(e.message);
                }

                if (this.ledgerSequence !== 0) {
                    nodeAddresses.forEach(address => this.crawlNode(new PeerNode(address[0], address[1])));
                }
            }
        );
    }

    crawlNode(peerNode: PeerNode) {
        //initialize
        peerNode.active = false;
        peerNode.isValidating = false;
        peerNode.overLoaded = false;

        if (this.allPeerNodes.has(peerNode.key)) {
            this.logger.debug({'peer': peerNode.key}, 'Node key already used for crawl');
            return;
        }

        this.logger.debug({'peer': peerNode.key}, 'Adding node to crawl queue');
        this.allPeerNodes.set(peerNode.key, peerNode);
        this.crawlQueue.push([peerNode], 1, (error) => {
            console.log(error) //todo: improve, when does this happen? global shutdown?
        });
    }

    protected processPeerNodeInCrawlQueue(peerNode: PeerNode, done: AsyncResultCallback<any>) {
        try {
            this.logger.info({'peer': peerNode.key}, 'Connecting');
            let connection = this.crawlerNode.connectTo(
                peerNode.ip,
                peerNode.port
            );
            connection.on("error", (error: Error) => console.log("error received: " + error));
            connection.on("connect", (publicKey: string, nodeInfo: NodeInfo) => this.onConnected(connection, publicKey, nodeInfo));
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
        this.logger.info("Finished with all nodes");
        this.logger.info(this.allPeerNodes.size + " nodes crawled of which are active: " + Array.from(this.activePeerNodesInCurrentCrawlByPublicKey.values()).filter(node => node.active).length);
        this.logger.info('of which are validating: ' + Array.from(this.activePeerNodesInCurrentCrawlByPublicKey.values()).filter(node => node.isValidating).length);
        this.logger.info('of which are overloaded: ' + Array.from(this.activePeerNodesInCurrentCrawlByPublicKey.values()).filter(node => node.overLoaded).length);
        this.logger.info(this.nodesThatSuppliedPeerList.size + " supplied us with a peers list.");
//todo add info on ip's that reuse public keys and such
        console.timeEnd("crawl")

        this.resolve(
            Array.from(this.activePeerNodesInCurrentCrawlByPublicKey.values()) //todo: only return active peernodes
        );

    }

    protected requestQuorumSetFromConnectedNodes(quorumSetHash: string, quorumSetOwnerPublicKey: string) {
        let isSent = false;
        //send to owner
        this.activeConnections.forEach(connection => {
                if (connection.remotePublicKey === quorumSetOwnerPublicKey) {
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
            this.logger.info({'peer': connection.remoteAddress}, 'Node disconnected');
            if (connection.remotePublicKey && this.processedValidatingNodes.has(connection.remotePublicKey)) { //if a node cant complete the handshake, but it is confirmed through other nodes that it is active and validating, we mark it as such.
                let node = this.activePeerNodesInCurrentCrawlByPublicKey.get(connection.remotePublicKey);
                if (node && !node.active) {
                    this.logger.debug({'peer': connection.remoteAddress}, 'Could not connect to node, but is confirmed validating. Marking node as overloaded and validating.'); //todo: way to go?
                    node.overLoaded = true;
                    node.active = true;
                    node.isValidating = true;
                } //node didn't complete handshake, but it is confirmed validating and thus active. This happens when the node has a high load and can't process messages quickly enough.
            }
            if (this.timeouts.get(connection.remoteAddress))
                clearTimeout(this.timeouts.get(connection.remoteAddress));

            if (this.activeConnections.has(connection.remoteAddress)) {
                this.activeConnections.delete(connection.remoteAddress);
            }

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

            let peerNode = this.allPeerNodes.get(connection.remoteAddress);
            if(!peerNode)
                throw new Error('peer node returned we did not connect to');

            peerNode.active = true;
            peerNode.ledgerVersion = nodeInfo.ledgerVersion;
            peerNode.overlayVersion = nodeInfo.overlayVersion;
            peerNode.overlayMinVersion = nodeInfo.overlayMinVersion;
            peerNode.networkId = nodeInfo.networkId;
            peerNode.versionStr = nodeInfo.versionString;


            if(this.activePeerNodesInCurrentCrawlByPublicKey.has(publicKey)){//this public key is already used in this crawl! A node is not allowed to reuse public keys. Disconnecting.
                this.logger.error({'peer': connection.remoteAddress, 'pk': publicKey}, 'Peernode reusing publickey on address ' + this.activePeerNodesInCurrentCrawlByPublicKey.get(publicKey)!.key);
                connection.destroy();
                return;
            }

            this.activePeerNodesInCurrentCrawlByPublicKey.set(publicKey, peerNode);
            this.activeConnections.set(connection.remoteAddress, connection);
            /*if (!this._nodesThatSuppliedPeerList.has(connection.peer)) { //Most nodes send their peers automatically on successful handshake
                this._connectionManager.sendGetPeers(connection);
            }*/
            if (this.processedValidatingNodes.has(publicKey)) { //we already confirmed that the node is validating by listening to externalize messages propagated by other nodes.
                this.logger.debug({'peer': connection.remoteAddress}, ': ' + connection.remotePublicKey + ' already confirmed validating, disconnecting');
                peerNode.isValidating = true;
                this.logger.info({'peer': connection.remoteAddress, 'pk': connection.remotePublicKey}, 'Validating');
                connection.destroy();
            } else {
                this.setSCPTimeout(peerNode);
                this.logger.debug({'peer': connection.remoteAddress}, ': send get scp status message');
                connection.sendStellarMessage(StellarMessage.getScpState(0));//a peernode can ignore this message when it has a high load.
                //this._connectionManager.sendGetScpStatus(connection, this._ledgerSequence)
            }
        } catch (error) {
            this.logger.error({'peer': connection.remoteAddress}, error.message);
        }
    }

    protected onPeersReceived(peers: Array<PeerNode>, connection: Connection) {
        try {
            this.logger.debug({'peer': connection.remoteAddress}, peers.length + ' peers received');
            this.nodesThatSuppliedPeerList.add(connection.remoteAddress);
            peers.forEach(peer => {
                if (!this.allPeerNodes.has(peer.key)) { //newly discovered peer
                    this.logger.debug({'peer': connection.remoteAddress}, 'supplied a newly discovered peer: ' + peer.key);
                    this.crawlNode(peer);
                } else {
                    this.logger.debug('peer ' + peer.key + ' already crawled');
                }
            });
        } catch (error) {
            this.logger.error({'peer': connection.remoteAddress}, error.message);
        }

    }

    protected onLoadTooHighReceived(connection: Connection) {
        try {
            this.logger.info({'peer': connection.remoteAddress}, 'Load too high message received');
            if (connection.remotePublicKey) {
                let node = this.activePeerNodesInCurrentCrawlByPublicKey.get(connection.remotePublicKey);
                if (node) {
                    node.active = true;
                    node.overLoaded = true;
                }
            }
        } catch (error) {
            this.logger.error({'peer': connection.remoteAddress}, error.message);
        }
    }

    protected onSCPStatementReceived(connection: Connection, scpStatement: ScpStatement) {

        let publicKey = getPublicKeyStringFromBuffer(scpStatement.nodeId().value()); //todo: compare with buffers for (slight) perf improvement?
        this.logger.debug({'peer': connection.remoteAddress}, scpStatement.pledges().switch().name + " message found for node " + publicKey + " for ledger " + scpStatement.slotIndex());

        if (Number(scpStatement.slotIndex) < this.ledgerSequence) {
            return; //older scp messages are ignored.
        }

        let scpNode = this.activePeerNodesInCurrentCrawlByPublicKey.get(publicKey); //todo: we should
        if (scpNode) {
            this.peerNodesParticipatingInSCP.add(scpNode.key);
        }

        if (scpStatement.pledges().switch().value !== ScpStatementType.scpStExternalize().value) { //only if node is externalizing, we mark the node as validating
            return;
        }

        this.logger.debug({'peer': connection.remoteAddress}, 'Externalize message found for ledger with sequence ' + scpStatement.slotIndex());
        this.logger.debug({'peer': connection.remoteAddress}, scpStatement.slotIndex() + ': ' + publicKey + ': ' + scpStatement.pledges().externalize().commit().value().toString('base64'));
        this.processedLedgers.add(Number(scpStatement.slotIndex)); // todo track values

        this.logger.debug({'peer': connection.remoteAddress}, publicKey + ' is validating on ledger:  ' + scpStatement.slotIndex());

        let quorumSetHash = scpStatement.pledges().externalize().commitQuorumSetHash().toString('base64');
        let quorumSetOwnerPublicKey = publicKey;

        try {
            this.logger.debug({'peer': connection.remoteAddress}, 'Detected quorumSetHash: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);

            if (scpNode) {
                if (scpNode.active)//we have successfully connected to node already, so we mark it as validating
                {
                    if (!scpNode.isValidating && !this.processedValidatingNodes.has(scpNode.publicKey!)) { //first time validating is detected
                        this.logger.info({
                            'peer': connection.remoteAddress,
                            'pk': connection.remotePublicKey
                        }, 'Validating');
                        scpNode.isValidating = true;
                    }
                }
            } else {
                this.logger.debug({'peer': connection.remoteAddress}, 'Quorumset owner unknown to us, skipping: ' + quorumSetOwnerPublicKey);
                return;
            }

            if (scpNode.quorumSet.hashKey === quorumSetHash) {
                this.logger.debug({'peer': connection.remoteAddress}, 'Quorumset already known to us for peer: ' + quorumSetOwnerPublicKey);
                //we don't need any more info for this node, fully processed
                this.processedValidatingNodes.add(publicKey); //node is confirmed validating and we have the quorumset. If we connect to it in the future, we can disconnect immediately and mark it as validating.//todo: disconnect if currently connected?
            } else {
                this.logger.info({'peer': connection.remoteAddress}, 'Unknown or modified quorumSetHash for peer, requesting it: ' + quorumSetOwnerPublicKey + ' => ' + quorumSetHash);
                let owners = this.quorumSetOwners.get(quorumSetHash);
                if (owners) {
                    if (owners.has(quorumSetOwnerPublicKey)) {
                        this.logger.debug({'peer': connection.remoteAddress}, 'Already logged quorumSetHash for owner: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);
                    } else {
                        owners.add(quorumSetOwnerPublicKey);
                        this.logger.debug({'peer': connection.remoteAddress}, 'Logged new owner for quorumSetHash: ' + quorumSetHash + ' owned by: ' + quorumSetOwnerPublicKey);
                    }
                } else {
                    this.quorumSetOwners.set(quorumSetHash, new Set([quorumSetOwnerPublicKey]));
                }
                this.logger.debug({'peer': connection.remoteAddress}, ': Requesting quorumset: ' + quorumSetHash);

                this.requestQuorumSetFromConnectedNodes(quorumSetHash, quorumSetOwnerPublicKey);
            }
        } catch (error) {
            this.logger.error({'peer': connection.remoteAddress}, error.message);
        }
    }

    protected onQuorumSetReceived(connection: Connection, quorumSet: QuorumSet) {
        try {
            this.logger.info({'peer': connection.remoteAddress}, 'QuorumSet received: ' + quorumSet.hashKey);
            if (!quorumSet.hashKey)
                throw new Error('Missing hashkey for quorumset');
            let owners = this.quorumSetOwners.get(quorumSet.hashKey);
            if (!owners) {
                return;
            }
            owners.forEach(owner => {
                let nodeWithNewQuorumSet = this.activePeerNodesInCurrentCrawlByPublicKey.get(owner);
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
            this.logger.error({'peer': connection.remoteAddress}, error.message);
        }
    }

    protected setSCPTimeout(node: PeerNode) {
        this.timeouts.set(node.key, setTimeout(() => {
            this.logger.debug({'peer': node.key}, 'SCP Listen timeout reached, disconnecting');

            if (this.peerNodesParticipatingInSCP.has(node.key) && !node.isValidating) {
                //a node could be reusing it's publickey on multiple ip's and thus be mapped to multiple peerNodes
                this.peerNodesParticipatingInSCP.delete(node.key);
                this.logger.debug({'peer': node.key}, 'Node was active in SCP, adding more time to listen for externalize messages');
                this.setSCPTimeout(node);
            } else {
                let connection = this.activeConnections.get(node.key);
                if (connection)
                    connection.destroy();
            }
        }, 5000)); //5 seconds for first scp message, correlated with Herder::EXP_LEDGER_TIMESPAN_SECONDS
    }
}