import { PeerNode } from '../peer-node';
import { listenFurther } from './listen-further';
import { truncate } from '../utilities/truncate';
import { P } from 'pino';
import { CrawlProcessState } from '../crawl-state';

export class PeerListenTimeoutManager {
	private static readonly SCP_LISTEN_TIMEOUT = 10000; //how long do we listen to determine if a node is participating in SCP. Correlated with Herder::EXP_LEDGER_TIMESPAN_SECONDS
	private static readonly CONSENSUS_STUCK_TIMEOUT = 35000; //https://github.com/stellar/stellar-core/blob/2b16c2599e9167c67032b402b71e37d2bf1b15e3/src/herder/Herder.cpp#L9C36-L9C36
	private listenTimeouts: Map<string, NodeJS.Timeout> = new Map();

	constructor(private logger: P.Logger) {}

	startTimer(
		peer: PeerNode,
		timeoutCounter: number,
		isTopTierNode: boolean,
		disconnectCallback: () => void,
		getCrawlProcessState: () => CrawlProcessState
	): void {
		if (
			!listenFurther(
				peer,
				timeoutCounter,
				//we wait max twice CONSENSUS_STUCK_TIMEOUT to ensure we receive al externalizing messages from straggling nodes;
				Math.ceil(
					(2 * PeerListenTimeoutManager.CONSENSUS_STUCK_TIMEOUT) /
						PeerListenTimeoutManager.SCP_LISTEN_TIMEOUT
				),
				isTopTierNode,
				getCrawlProcessState() === CrawlProcessState.STOPPING
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
				'Peer validation state determined, disconnecting'
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
		this.listenTimeouts.set(
			peer.publicKey,
			setTimeout(() => {
				this.logger.debug(
					{ pk: truncate(peer.publicKey) },
					'SCP Listen timeout reached'
				);
				timeoutCounter++;
				this.startTimer(
					peer,
					timeoutCounter,
					isTopTierNode,
					disconnectCallback,
					getCrawlProcessState
				);
			}, PeerListenTimeoutManager.SCP_LISTEN_TIMEOUT)
		);
	}

	stopTimer(peer: PeerNode): void {
		const timeout = this.listenTimeouts.get(peer.publicKey);
		if (timeout) {
			clearTimeout(timeout);
			this.listenTimeouts.delete(peer.publicKey);
		}
	}
}
