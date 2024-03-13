import { NodeAddress } from '../node-address';
import { StragglerTimer } from './straggler-timer';
import { ConnectionManager } from './connection-manager';
import { P } from 'pino';
import { Ledger } from '../crawler';
import { Observation } from './observation';
import { ConsensusTimer } from './consensus-timer';

export class ObservationManager {
	constructor(
		private connectionManager: ConnectionManager,
		private consensusTimer: ConsensusTimer,
		private stragglerTimer: StragglerTimer,
		private syncingTimeoutMS: number,
		private logger: P.Logger
	) {}

	public async startSync(observation: Observation) {
		this.logger.info('Moving to syncing state');
		observation.moveToSyncingState();
		this.connectToTopTierNodes(observation.topTierAddresses);

		await this.timeout(this.syncingTimeoutMS);
		return this.syncCompleted(observation);
	}

	public syncCompleted(observation: Observation) {
		this.logger.info('Moving to synced state');
		observation.moveToSyncedState();
		this.startNetworkConsensusTimer(observation);
	}

	public ledgerCloseConfirmed(observation: Observation, ledger: Ledger) {
		observation.ledgerCloseConfirmed(ledger);
		this.stragglerTimer.startStragglerTimeoutForActivePeers(
			false,
			observation.topTierAddressesSet
		);

		this.startNetworkConsensusTimer(observation);
	}

	private startNetworkConsensusTimer(observation: Observation) {
		this.startNetworkConsensusTimerInternal(
			this.onNetworkHalted.bind(this, observation)
		);
	}

	private onNetworkHalted(observation: Observation) {
		this.logger.info('Network consensus timeout');
		observation.networkHalted = true;
		this.stragglerTimer.startStragglerTimeoutForActivePeers(
			false,
			observation.topTierAddressesSet
		);
	}

	public stopObservation(observation: Observation, doneCallback: () => void) {
		this.logger.info('Moving to stopping state');
		observation.moveToStoppingState();

		this.consensusTimer.stop();
		if (this.connectionManager.getActiveConnectionAddresses().length === 0) {
			return this.onLastNodesDisconnected(observation, doneCallback);
		}

		this.stragglerTimer.startStragglerTimeoutForActivePeers(
			true,
			observation.topTierAddressesSet,
			() => this.onLastNodesDisconnected(observation, doneCallback)
		);
	}

	private onLastNodesDisconnected(
		observation: Observation,
		onStopped: () => void
	) {
		this.logger.info('Moving to stopped state');
		observation.moveToStoppedState();

		this.stragglerTimer.stopStragglerTimeouts();
		this.connectionManager.shutdown();

		onStopped();
	}

	private startNetworkConsensusTimerInternal(onNetworkHalted: () => void) {
		this.consensusTimer.start(onNetworkHalted);
	}

	private connectToTopTierNodes(topTierNodes: NodeAddress[]) {
		topTierNodes.forEach((address) => {
			this.connectionManager.connectToNode(address[0], address[1]);
		});
	}

	private timeout(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
