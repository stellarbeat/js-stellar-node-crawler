import { Connection, ConnectionManager } from "@stellarbeat/js-stellar-node-connector";
import { Node, QuorumSet } from '@stellarbeat/js-stellar-domain';
export declare class Crawler {
    _busyCounter: number;
    _allNodes: Map<string, Node>;
    _activeConnections: Map<string, Connection>;
    _nodesThatSuppliedPeerList: Set<Node>;
    _keyPair: any;
    _usePublicNetwork: boolean;
    _quorumSetHashes: Map<string, Set<string>>;
    _connectionManager: ConnectionManager;
    _resolve: any;
    _reject: any;
    _durationInMilliseconds: number;
    _logger: any;
    _nodesToCrawl: Array<Node>;
    _weight: number;
    _maxWeight: number;
    _activeNodeWeight: number;
    _defaultNodeWeight: number;
    constructor(usePublicNetwork?: boolean, durationInMilliseconds?: number, logger?: any);
    setLogger(logger: any): void;
    initializeDefaultLogger(): void;
    /**
     *
     * @param nodesSeed
     * @returns {Promise<any>}
     */
    crawl(nodesSeed: Array<Node>): Promise<Array<Node>>;
    crawlNode(node: Node): void;
    addWeight(node: Node): void;
    removeWeight(node: Node): void;
    processCrawlQueue(): void;
    wrapUp(node: Node): void;
    requestQuorumSetFromConnectedNodes(quorumSetHash: string, quorumSetOwnerPublicKey: string): void;
    onNodeDisconnected(connection: Connection): void;
    onHandshakeCompleted(connection: Connection): void;
    onPeersReceived(peers: Array<Node>, connection: Connection): void;
    onLoadTooHighReceived(connection: Connection): void;
    onQuorumSetHashDetected(connection: Connection, quorumSetHash: string, quorumSetOwnerPublicKey: string): void;
    onQuorumSetReceived(connection: Connection, quorumSet: QuorumSet): void;
}
