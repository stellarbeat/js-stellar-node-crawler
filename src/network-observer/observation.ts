import { ObservationState } from './network-observer';
import { CrawlState } from '../crawl-state';
import { NodeAddress } from '../node-address';
import { PeerNodeCollection } from '../peer-node-collection';

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
}
