import { Connection } from '@stellarbeat/js-stellar-node-connector';
import { PublicKey, QuorumSet } from '@stellarbeat/js-stellar-domain';
import { PeerNode } from './peer-node';
import { Ledger } from './crawler';
import { Slots } from './slots';
import * as LRUCache from 'lru-cache';
import * as P from 'pino';

type QuorumSetHash = string;
type PeerKey = string; //ip:port

export class QuorumSetState {
	quorumSetOwners: Map<QuorumSetHash, Set<PublicKey>> = new Map();
	quorumSetRequestedTo: Map<QuorumSetHash, Set<PublicKey>> = new Map();
	quorumSetHashesInProgress: Set<QuorumSetHash> = new Set();
	quorumSetRequests: Map<
		PublicKey,
		{
			timeout: NodeJS.Timeout;
			hash: QuorumSetHash;
		}
	> = new Map();
}

export class CrawlState {
	maxCrawlTimeHit = false;
	openConnections: Map<PublicKey, Connection> = new Map<
		PublicKey,
		Connection
	>();
	peerNodes: Map<PublicKey, PeerNode> = new Map<PublicKey, PeerNode>();
	quorumSets: Map<string, QuorumSet>;
	crawledNodeAddresses: Set<PeerKey> = new Set();
	latestClosedLedger: Ledger = {
		sequence: BigInt(0),
		closeTime: new Date(0)
	};
	listenTimeouts: Map<PublicKey, NodeJS.Timeout> = new Map();
	slots: Slots;
	envelopeCache: LRUCache<string, number>;
	quorumSetState: QuorumSetState = new QuorumSetState();
	failedConnections: string[] = [];

	constructor(
		topTierQuorumSet: QuorumSet,
		quorumSets: Map<string, QuorumSet>,
		latestClosedLedger: Ledger,
		protected logger: P.Logger
	) {
		this.quorumSets = quorumSets;
		this.latestClosedLedger = latestClosedLedger;
		this.slots = new Slots(topTierQuorumSet, logger);
		this.envelopeCache = new LRUCache<string, number>(5000);
	}
}
