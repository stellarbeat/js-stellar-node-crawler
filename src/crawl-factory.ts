import { Crawl } from './crawl';
import { ObservationFactory } from './network-observer/observation-factory';
import { Slots } from './network-observer/peer-event-handler/stellar-message-handlers/scp-envelope/scp-statement/externalize/slots';
import { NodeAddress } from './node-address';
import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { Ledger } from './crawler';
import { P } from 'pino';
import { PeerNodeCollection } from './peer-node-collection';

export class CrawlFactory {
	constructor(private observationFactory: ObservationFactory) {}
	public createCrawl(
		network: string, //todo: configuration?
		nodesToCrawl: NodeAddress[],
		topTierAddresses: NodeAddress[],
		topTierQuorumSet: QuorumSet,
		latestConfirmedClosedLedger: Ledger,
		quorumSets: Map<string, QuorumSet>,
		logger: P.Logger
	): Crawl {
		const observation = this.observationFactory.createObservation(
			network,
			new Slots(topTierQuorumSet, logger),
			topTierAddresses,
			new PeerNodeCollection(),
			latestConfirmedClosedLedger,
			quorumSets
		);
		return new Crawl(nodesToCrawl, observation);
	}
}
