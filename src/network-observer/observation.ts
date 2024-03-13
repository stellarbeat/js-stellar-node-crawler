import { CrawlState } from '../crawl-state';
import { NodeAddress } from '../node-address';
import { PeerNodeCollection } from '../peer-node-collection';
import * as assert from 'assert';
import { Ledger } from '../crawler';
import { ObservationState } from './observation-state';

export class Observation {
	public state: ObservationState = ObservationState.Idle;
	public networkHalted = false;
	public topTierAddressesSet: Set<string>;

	constructor(
		public topTierAddresses: NodeAddress[],
		public peerNodes: PeerNodeCollection,
		public crawlState: CrawlState
	) {
		this.topTierAddressesSet = this.mapTopTierAddresses(topTierAddresses);
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
		if (this.state !== ObservationState.Synced) return;
		if (this.networkHalted) return;

		this.crawlState.updateLatestConfirmedClosedLedger(ledger);
	}
}
