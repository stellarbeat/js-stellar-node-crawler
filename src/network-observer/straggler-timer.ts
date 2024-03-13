import { ConnectionManager } from './connection-manager';
import { P } from 'pino';
import { Timers } from '../utilities/timers';

export class StragglerTimer {
	constructor(
		private connectionManager: ConnectionManager,
		private timers: Timers,
		private straggleTimeoutMS: number,
		private logger: P.Logger
	) {}

	public startStragglerTimeoutForActivePeers(
		includeTopTier = false,
		topTierAddresses: Set<string>,
		done?: () => void
	) {
		const activePeers = this.connectionManager
			.getActiveConnectionAddresses()
			.filter((address) => {
				return includeTopTier || !topTierAddresses.has(address);
			});
		this.startStragglerTimeout(activePeers, done);
	}

	public startStragglerTimeout(addresses: string[], done?: () => void) {
		if (addresses.length === 0) return;
		this.timers.startTimer(this.straggleTimeoutMS, () => {
			this.logger.debug({ addresses }, 'Straggler timeout hit');
			addresses.forEach((address) => {
				this.connectionManager.disconnectByAddress(address);
			});
			if (done) done();
		});
	}

	public stopStragglerTimeouts() {
		this.timers.stopTimers();
	}
}
