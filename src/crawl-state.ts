import { PublicKey, QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { Ledger } from './crawler';
import * as LRUCache from 'lru-cache';
import * as P from 'pino';
import { truncate } from './utilities/truncate';
import { PeerNodeCollection } from './peer-node-collection';
import { AsyncResultCallback } from 'async';
import { Slots } from './stellar-message-handlers/scp-envelope/scp-statement/externalize/slots';
import { NodeAddress } from './node-address';

type QuorumSetHash = string;
type PeerKey = string; //ip:port

export enum CrawlProcessState {
	IDLE,
	TOP_TIER_SYNC,
	CRAWLING
}

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
	state: CrawlProcessState = CrawlProcessState.IDLE;
	network: string;
	maxCrawlTimeHit = false;
	crawlQueueTaskDoneCallbacks: Map<string, AsyncResultCallback<void>> =
		new Map();

	peerNodes: PeerNodeCollection;
	quorumSets: Map<string, QuorumSet>;
	crawledNodeAddresses: Set<PeerKey> = new Set();
	latestConfirmedClosedLedger: Ledger = {
		sequence: BigInt(0),
		closeTime: new Date(0),
		value: '',
		localCloseTime: new Date(0)
	};
	slots: Slots;
	envelopeCache: LRUCache<string, number>;
	quorumSetState: QuorumSetState = new QuorumSetState();
	failedConnections: string[] = [];
	topTierNodes: Set<PublicKey>;
	peerAddressesReceivedDuringSync: NodeAddress[] = [];

	constructor(
		topTierQuorumSet: QuorumSet,
		quorumSets: Map<string, QuorumSet>,
		latestClosedLedger: Ledger,
		network: string,
		protected logger: P.Logger
	) {
		this.quorumSets = quorumSets;
		this.latestConfirmedClosedLedger = latestClosedLedger;
		this.slots = new Slots(topTierQuorumSet, logger);
		this.envelopeCache = new LRUCache<string, number>(5000);
		this.topTierNodes = new Set(
			topTierQuorumSet.validators.map((validator) => validator.toString())
		);
		this.peerNodes = new PeerNodeCollection();
		this.network = network;
	}

	log() {
		this.logger.debug({ peers: this.failedConnections }, 'Failed connections');
		this.peerNodes.getAll().forEach((peer) => {
			this.logger.info({
				ip: peer.key,
				pk: truncate(peer.publicKey),
				connected: peer.successfullyConnected,
				scp: peer.participatingInSCP,
				validating: peer.isValidating,
				overLoaded: peer.overLoaded,
				lagMS: peer.getMinLagMS(),
				connectedWhileExternalizing: peer.connectedDuringLedgerClose,
				incorrect: peer.isValidatingIncorrectValues
			});
		});
		this.logger.info('Connection attempts: ' + this.crawledNodeAddresses.size);
		this.logger.info('Detected public keys: ' + this.peerNodes.size);
		this.logger.info(
			'Successful connections: ' +
				Array.from(this.peerNodes.getAll().values()).filter(
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
			Array.from(this.peerNodes.values()).filter(
				(node) => node.suppliedPeerList
			).length + ' supplied us with a peers list.'
		);
		this.logger.info(
			'Closed ledgers: ' + this.slots.getConfirmedClosedSlotIndexes().length
		);
	}
}
