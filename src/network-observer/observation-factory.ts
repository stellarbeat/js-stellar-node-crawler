import { Observation } from './observation';
import { NodeAddress } from '../node-address';
import { PeerNodeCollection } from '../peer-node-collection';
import { CrawlState } from '../crawl-state';

export class ObservationFactory {
	public createObservation(
		topTierAddresses: NodeAddress[],
		peerNodes: PeerNodeCollection,
		crawlState: CrawlState
	): Observation {
		return new Observation(topTierAddresses, peerNodes, crawlState);
	}
}
