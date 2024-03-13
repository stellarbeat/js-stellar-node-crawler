import { ClosePayload } from '../connection-manager';
import { SyncState } from '../network-observer';
import { truncate } from '../../utilities/truncate';
import { QuorumSetManager } from '../quorum-set-manager';
import { P } from 'pino';

export class OnPeerConnectionClosed {
	constructor(
		private quorumSetManager: QuorumSetManager,
		private logger: P.Logger
	) {}

	public handle(data: ClosePayload, syncState: SyncState) {
		this.logIfTopTierDisconnect(data, syncState.topTierAddresses);
		if (data.publicKey) {
			this.quorumSetManager.onNodeDisconnected(
				data.publicKey,
				syncState.crawlState
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
