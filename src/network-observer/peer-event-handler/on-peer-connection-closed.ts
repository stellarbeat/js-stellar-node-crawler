import { ClosePayload } from '../connection-manager';
import { truncate } from '../../utilities/truncate';
import { QuorumSetManager } from '../quorum-set-manager';
import { P } from 'pino';
import { Observation } from '../observation';

export class OnPeerConnectionClosed {
	constructor(
		private quorumSetManager: QuorumSetManager,
		private logger: P.Logger
	) {}

	public handle(data: ClosePayload, observation: Observation) {
		this.logIfTopTierDisconnect(data, observation.topTierAddressesSet);
		if (data.publicKey) {
			this.quorumSetManager.onNodeDisconnected(
				data.publicKey,
				observation.crawlState
			);
		}
	}

	private logIfTopTierDisconnect(
		data: ClosePayload,
		topTierAddresses: Set<string>
	) {
		if (topTierAddresses.has(data.address)) {
			this.logger.debug(
				{ pk: truncate(data.publicKey), address: data.address },
				'Top tier node disconnected'
			);
		}
	}
}
