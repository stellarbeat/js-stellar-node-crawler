import { Observation } from './observation';
import { NodeAddress } from '../node-address';
import { PeerNodeCollection } from '../peer-node-collection';
import { Slots } from './peer-event-handler/stellar-message-handlers/scp-envelope/scp-statement/externalize/slots';
import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { Ledger } from '../crawler';

export class ObservationFactory {
	public createObservation(
		network: string,
		slots: Slots,
		topTierAddresses: NodeAddress[],
		peerNodes: PeerNodeCollection,
		latestConfirmedClosedLedger: Ledger,
		quorumSets: Map<string, QuorumSet>
	): Observation {
		return new Observation(
			network,
			topTierAddresses,
			peerNodes,
			latestConfirmedClosedLedger,
			quorumSets,
			slots
		);
	}
}
