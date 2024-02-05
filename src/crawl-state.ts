import { Connection } from '@stellarbeat/js-stellar-node-connector';
import { PublicKey, QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { PeerNode } from './peer-node';
import { Ledger } from './crawler';
import { Slots } from './slots';
import * as LRUCache from 'lru-cache';
import * as P from 'pino';
import { truncate } from './truncate';

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
	topTierNodes: Set<PublicKey>;
	loggingTimer?: NodeJS.Timeout;

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
		this.topTierNodes = new Set(
			topTierQuorumSet.validators.map((validator) => validator.toString())
		);
	}

	log() {
		this.logger.info({ peers: this.failedConnections }, 'Failed connections');
		this.peerNodes.forEach((peer) => {
			this.logger.info({
				ip: peer.key,
				pk: truncate(peer.publicKey),
				connected: peer.successfullyConnected,
				scp: peer.participatingInSCP,
				validating: peer.isValidating,
				overLoaded: peer.overLoaded
			});
		});
		this.logger.info('Connection attempts: ' + this.crawledNodeAddresses.size);
		this.logger.info('Detected public keys: ' + this.peerNodes.size);
		this.logger.info(
			'Successful connections: ' +
				Array.from(this.peerNodes.values()).filter(
					(peer) => peer.successfullyConnected
				).length
		);
		this.logger.info(
			'Validating nodes: ' +
				Array.from(this.peerNodes.values()).filter((node) => node.isValidating)
					.length
		);
		this.logger.info(
			'Overloaded nodes: ' +
				Array.from(this.peerNodes.values()).filter((node) => node.overLoaded)
					.length
		);

		this.logger.info(
			'Closed ledgers: ' + this.slots.getClosedSlotIndexes().length
		);
		this.logger.info(
			Array.from(this.peerNodes.values()).filter(
				(node) => node.suppliedPeerList
			).length + ' supplied us with a peers list.'
		);
	}
}
