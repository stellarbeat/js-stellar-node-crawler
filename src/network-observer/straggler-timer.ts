import { Timer } from '../utilities/timer';
import { ConnectionManager } from './connection-manager';
import { P } from 'pino';

export class StragglerTimer {
	public static readonly PEER_STRAGGLE_TIMEOUT = 10000; //if the network has externalized, a node has 10 seconds to catch up.

	private timers: Set<Timer> = new Set();

	constructor(
		private connectionManager: ConnectionManager,
		private logger: P.Logger
	) {}

	public startStragglerTimeoutForActivePeers(
		includeTopTier = false,
		topTierAddresses: Set<string>
	) {
		const activePeers = this.connectionManager
			.getActiveConnectionAddresses()
			.filter((address) => {
				return includeTopTier || !topTierAddresses.has(address);
			});
		this.startStragglerTimeout(activePeers);
	}

	public startStragglerTimeout(addresses: string[]) {
		if (addresses.length === 0) return;
		this.startTimer(StragglerTimer.PEER_STRAGGLE_TIMEOUT, () => {
			this.logger.debug({ addresses }, 'Straggler timeout hit');
			addresses.forEach((address) => {
				this.connectionManager.disconnectByAddress(address);
			});
		});
	}

	private startTimer(time: number, callback: () => void) {
		const timer = new Timer();
		const myCallback = () => {
			this.timers.delete(timer);
			callback();
		};
		timer.startTimer(time, callback);
		this.timers.add(timer);
	}

	stopTimers() {
		this.timers.forEach((timer) => timer.stopTimer());
	}
}
