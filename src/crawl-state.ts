import {Connection} from "@stellarbeat/js-stellar-node-connector";
import {PublicKey, QuorumSet} from "@stellarbeat/js-stellar-domain";
import {PeerNode} from "./peer-node";
import {Ledger} from "./crawler";
import {Slots} from "./slots";
import * as LRUCache from "lru-cache";

type QuorumSetHash = string;
type PeerKey = string;//ip:port

export class QuorumSetState{
    quorumSetOwners: Map<QuorumSetHash, Set<PublicKey>> = new Map();
    quorumSetRequestedTo: Map<QuorumSetHash, Set<PublicKey>> = new Map();
    quorumSetRequests: Map<PublicKey, {
        timeout: NodeJS.Timeout,
        hash: QuorumSetHash
    }> = new Map();
    quorumSetRequestHashesInProgress: Set<QuorumSetHash> = new Set();
    unknownQuorumSets: Set<QuorumSetHash> = new Set();
}

export class CrawlState {
    openConnections: Map<PublicKey, Connection> = new Map<PublicKey, Connection>();
    peerNodes: Map<PublicKey, PeerNode> = new Map<PublicKey, PeerNode>();
    quorumSets: Map<QuorumSetHash, QuorumSet>;
    crawledNodeAddresses: Set<PeerKey> = new Set();
    latestClosedLedger: Ledger = {
        sequence: BigInt(0),
        closeTime: new Date(0)
    };
    listenTimeouts: Map<PublicKey, any> = new Map();
    slots: Slots;
    envelopeCache: LRUCache<string, number>;
    quorumSetState: QuorumSetState = new QuorumSetState();

    constructor(topTierQuorumSet: QuorumSet, quorumSets: Map<QuorumSetHash, QuorumSet>, latestClosedLedger: Ledger) {
        this.quorumSets = quorumSets;
        this.latestClosedLedger = latestClosedLedger;
        this.slots = new Slots(topTierQuorumSet);
        this.envelopeCache = new LRUCache<string, number>(5000)
    }
}