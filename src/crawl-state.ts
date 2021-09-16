import {Connection} from "@stellarbeat/js-stellar-node-connector";
import {PublicKey, QuorumSet} from "@stellarbeat/js-stellar-domain";
import {PeerNode} from "./peer-node";

type QuorumSetHash = string;

export class CrawlState {
    openConnections: Map<PublicKey, Connection> = new Map<PublicKey, Connection>();
    peerNodes: Map<PublicKey, PeerNode> = new Map<PublicKey, PeerNode>();
    quorumSets: Map<QuorumSetHash, QuorumSet>;


    constructor(quorumSets: Map<QuorumSetHash, QuorumSet>) {
        this.quorumSets = quorumSets;
    }
}