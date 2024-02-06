import { PeerNode } from './peer-node';
import { CrawlState } from './crawl-state';
import { peerValidationStateNotYetDetermined } from './peer-validation-state-not-yet-determined';
import { truncate } from './truncate';
import { P } from 'pino';

export class DisconnectTimeout {
	private static readonly SCP_LISTEN_TIMEOUT = 10000; //how long do we listen to determine if a node is participating in SCP. Correlated with Herder::EXP_LEDGER_TIMESPAN_SECONDS
	private static readonly CONSENSUS_STUCK_TIMEOUT = 35000; //https://github.com/stellar/stellar-core/blob/2b16c2599e9167c67032b402b71e37d2bf1b15e3/src/herder/Herder.cpp#L9C36-L9C36

	constructor(private logger: P.Logger) {}

	start(
		peer: PeerNode,
		timeoutCounter = 0,
		crawlState: CrawlState,
		disconnectCallback: () => void,
		readyWithNonTopTierPeers: () => boolean
	): void {
		if (
			!peerValidationStateNotYetDetermined(
				peer,
				timeoutCounter,
				//we wait max twice CONSENSUS_STUCK_TIMEOUT to ensure we receive al externalizing messages from straggling nodes;
				Math.ceil(
					(2 * DisconnectTimeout.CONSENSUS_STUCK_TIMEOUT) /
						DisconnectTimeout.SCP_LISTEN_TIMEOUT
				),
				crawlState.topTierNodes,
				readyWithNonTopTierPeers(),
				crawlState.peerNodes
			)
		) {
			this.logger.debug(
				{
					pk: truncate(peer.publicKey),
					counter: timeoutCounter,
					validating: peer.isValidating,
					validatingIncorrectly: peer.isValidatingIncorrectValues,
					scp: peer.participatingInSCP
				},
				'Disconnect'
			);
			disconnectCallback();
			return;
		}
		this.logger.debug(
			{
				pk: truncate(peer.publicKey),
				latestActiveSlotIndex: peer.latestActiveSlotIndex
			},
			'Listening for externalize msg'
		);
		crawlState.listenTimeouts.set(
			peer.publicKey,
			setTimeout(() => {
				this.logger.debug(
					{ pk: truncate(peer.publicKey) },
					'SCP Listen timeout reached'
				);
				timeoutCounter++;
				this.start(
					peer,
					timeoutCounter,
					crawlState,
					disconnectCallback,
					readyWithNonTopTierPeers
				);
			}, DisconnectTimeout.SCP_LISTEN_TIMEOUT)
		);
	}
}
