import { NodeAddress } from '../node-address';
import { PeerNodeCollection } from '../peer-node-collection';
import * as assert from 'assert';
import { Ledger } from '../crawler';
import { ObservationState } from './observation-state';
import { Slots } from './peer-event-handler/stellar-message-handlers/scp-envelope/scp-statement/externalize/slots';
import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import * as LRUCache from 'lru-cache';
import { QuorumSetState } from './quorum-set-state';

export class Observation {
	public state: ObservationState = ObservationState.Idle;
	private networkHalted = false;
	public topTierAddressesSet: Set<string>;
	public envelopeCache: LRUCache<string, number>;
	public quorumSetState: QuorumSetState = new QuorumSetState();

	constructor(
		public network: string,
		public topTierAddresses: NodeAddress[],
		public peerNodes: PeerNodeCollection,
		public latestConfirmedClosedLedger: Ledger,
		public quorumSets: Map<string, QuorumSet>,
		public slots: Slots
	) {
		this.topTierAddressesSet = this.mapTopTierAddresses(topTierAddresses);
		this.envelopeCache = new LRUCache<string, number>(5000);
	}

	private mapTopTierAddresses(topTierNodes: NodeAddress[]) {
		const topTierAddresses = new Set<string>();
		topTierNodes.forEach((address) => {
			topTierAddresses.add(`${address[0]}:${address[1]}`);
		});
		return topTierAddresses;
	}

	moveToSyncingState() {
		assert(this.state === ObservationState.Idle);
		this.state = ObservationState.Syncing;
	}

	moveToSyncedState() {
		assert(this.state === ObservationState.Syncing);
		this.state = ObservationState.Synced;
	}

	moveToStoppingState() {
		assert(this.state !== ObservationState.Idle);
		this.state = ObservationState.Stopping;
	}

	moveToStoppedState() {
		assert(this.state === ObservationState.Stopping);
		this.state = ObservationState.Stopped;
	}

	ledgerCloseConfirmed(ledger: Ledger) {
		this.networkHalted = false;
		if (this.state !== ObservationState.Synced) return;

		this.latestConfirmedClosedLedger = ledger;
	}

	isNetworkHalted(): boolean {
		return this.networkHalted;
	}

	setNetworkHalted() {
		this.networkHalted = true;
	}
}
