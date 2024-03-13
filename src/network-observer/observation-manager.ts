import { NodeAddress } from '../node-address';
import { ObservationState } from './network-observer';
import { StragglerTimer } from './straggler-timer';
import { ConnectionManager } from './connection-manager';
import * as assert from 'assert';
import { P } from 'pino';
import { Ledger } from '../crawler';
import { ConsensusTimer } from './consensus-timer';
import { Observation } from './observation';

export class ObservationManager {
	constructor(
		private connectionManager: ConnectionManager,
		private consensusTimer: ConsensusTimer,
		private stragglerTimer: StragglerTimer,
		private logger: P.Logger
	) {}

	public moveToSyncingState(observation: Observation): void {
		this.logger.info('Moving to syncing state');
		assert(observation.state === ObservationState.Idle);
		observation.state = ObservationState.Syncing;
		observation.networkHalted = false;

		this.connectToTopTierNodes(observation.topTierAddresses);
	}

	public moveToSyncedState(observation: Observation) {
		this.logger.info('Moving to synced state');
		assert(observation.state === ObservationState.Syncing);
		observation.state = ObservationState.Synced;
		this.startNetworkConsensusTimer(observation);
	}

	public ledgerCloseConfirmed(observation: Observation, ledger: Ledger) {
		if (observation.state !== ObservationState.Synced) return;
		if (observation.networkHalted) return;

		observation.crawlState.updateLatestConfirmedClosedLedger(ledger);

		this.stragglerTimer.startStragglerTimeoutForActivePeers(
			false,
			observation.topTierAddressesSet
		);

		this.startNetworkConsensusTimer(observation);
	}

	private startNetworkConsensusTimer(observation: Observation) {
		const onNetworkHaltedCallback = () => {
			this.logger.info('Network consensus timeout');
			observation.networkHalted = true;
			this.stragglerTimer.startStragglerTimeoutForActivePeers(
				false,
				observation.topTierAddressesSet
			);
		};
		this.startNetworkConsensusTimerInternal(onNetworkHaltedCallback);
	}

	public moveToStoppingState(
		observation: Observation,
		doneCallback: () => void
	) {
		this.logger.info('Moving to stopping state');
		assert(observation.state !== ObservationState.Idle);
		observation.state = ObservationState.Stopping;
		this.consensusTimer.stop();
		if (this.connectionManager.getActiveConnectionAddresses().length === 0) {
			return this.moveToStoppedState(observation, doneCallback);
		}

		this.stragglerTimer.startStragglerTimeoutForActivePeers(
			true,
			observation.topTierAddressesSet,
			() => this.moveToStoppedState(observation, doneCallback)
		);
	}

	public moveToStoppedState(observation: Observation, callback: () => void) {
		this.logger.info('Moving to idle state');
		assert(observation.state === ObservationState.Stopping);
		this.stragglerTimer.stopStragglerTimeouts(); //a node could have disconnected during the straggler timeout
		this.connectionManager.shutdown();
		observation.state = ObservationState.Stopped;
		callback();
	}

	private startNetworkConsensusTimerInternal(onNetworkHalted: () => void) {
		this.consensusTimer.start(onNetworkHalted);
	}

	private connectToTopTierNodes(topTierNodes: NodeAddress[]) {
		topTierNodes.forEach((address) => {
			this.connectionManager.connectToNode(address[0], address[1]);
		});
	}
}
