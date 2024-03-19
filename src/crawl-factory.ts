import { Crawl } from './crawl';
import { ObservationFactory } from './network-observer/observation-factory';
import { Slots } from './network-observer/peer-event-handler/stellar-message-handlers/scp-envelope/scp-statement/externalize/slots';
import { NodeAddress } from './node-address';
import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { Ledger } from './crawler';
import { P } from 'pino';
import { PeerNodeCollection } from './peer-node-collection';

export class CrawlFactory {
	constructor(
		private observationFactory: ObservationFactory,
		private network: string,
		private logger: P.Logger
	) {}
	public createCrawl(
		nodesToCrawl: NodeAddress[],
		topTierAddresses: NodeAddress[],
		topTierQuorumSet: QuorumSet,
		latestConfirmedClosedLedger: Ledger,
		quorumSets: Map<string, QuorumSet>
	): Crawl {
		const observation = this.observationFactory.createObservation(
			this.network,
			new Slots(topTierQuorumSet, this.logger),
			topTierAddresses,
			new PeerNodeCollection(),
			latestConfirmedClosedLedger,
			quorumSets
		);
		return new Crawl(nodesToCrawl, observation);
	}
}
