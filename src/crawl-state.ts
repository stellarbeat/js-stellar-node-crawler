import {Connection} from "@stellarbeat/js-stellar-node-connector";
import {PublicKey, QuorumSet} from "@stellarbeat/js-stellar-domain";
import {PeerNode} from "./peer-node";
import {Ledger} from "./crawler";
import {Slots} from "./slots";

type QuorumSetHash = string;
type PeerKey = string;//ip:port

export class CrawlState {
    openConnections: Map<PublicKey, Connection> = new Map<PublicKey, Connection>();
    peerNodes: Map<PublicKey, PeerNode> = new Map<PublicKey, PeerNode>();
    quorumSets: Map<QuorumSetHash, QuorumSet>;
    crawledNodeAddresses: Set<PeerKey> = new Set();
    latestClosedLedger: Ledger = {
        sequence: BigInt(0),
        closeTime: new Date(0)
    };
    listenTimeouts: Map<string, any> = new Map();
    slots: Slots;

    constructor(topTierQuorumSet: QuorumSet, quorumSets: Map<QuorumSetHash, QuorumSet>, latestClosedLedger: Ledger) {
        this.quorumSets = quorumSets;
        this.latestClosedLedger = latestClosedLedger;
        this.slots = new Slots(topTierQuorumSet);
    }
}