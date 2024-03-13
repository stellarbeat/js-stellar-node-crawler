import { ObservationManager } from '../observation-manager';
import { mock } from 'jest-mock-extended';
import { ConnectionManager } from '../connection-manager';
import { ConsensusTimer } from '../consensus-timer';
import { StragglerTimer } from '../straggler-timer';
import { P } from 'pino';
import { Observation } from '../observation';
import { PeerNodeCollection } from '../../peer-node-collection';
import { CrawlState } from '../../crawl-state';
import { ObservationState } from '../observation-state';

describe('ObservationManager', () => {
	const connectionManager = mock<ConnectionManager>();
	const consensusTimer = mock<ConsensusTimer>();
	const stragglerTimer = mock<StragglerTimer>();
	const logger = mock<P.Logger>();

	const observationManager = new ObservationManager(
		connectionManager,
		consensusTimer,
		stragglerTimer,
		200,
		logger
	);

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('should start syncing', (resolve) => {
		const peerNodes = new PeerNodeCollection();
		const observation = new Observation(
			[['localhost', 11625]],
			peerNodes,
			mock<CrawlState>()
		);
		observationManager.startSync(observation).then(() => {
			expect(connectionManager.connectToNode).toHaveBeenCalledWith(
				observation.topTierAddresses[0][0],
				observation.topTierAddresses[0][1]
			);
			expect(consensusTimer.start).toHaveBeenCalled();
			expect(observation.state).toBe(ObservationState.Synced);
			resolve();
		});

		expect(observation.state).toBe(ObservationState.Syncing);
	});

	it('should stop observation immediately if no more active nodes', (resolve) => {
		connectionManager.getNumberOfActiveConnections.mockReturnValue(0);
		const peerNodes = new PeerNodeCollection();
		const observation = new Observation(
			[['localhost', 11625]],
			peerNodes,
			mock<CrawlState>()
		);
		observation.moveToSyncingState();
		observation.moveToSyncedState();
		observationManager.stopObservation(observation, () => {});

		expect(observation.state).toBe(ObservationState.Stopped);
		expect(consensusTimer.stop).toHaveBeenCalled();
		expect(stragglerTimer.stopStragglerTimeouts).toHaveBeenCalled();
		expect(connectionManager.shutdown).toHaveBeenCalled();
		resolve();
	});

	it('should stop observation after all active nodes are disconnected', (resolve) => {
		connectionManager.getNumberOfActiveConnections.mockReturnValue(1);
		const peerNodes = new PeerNodeCollection();
		const observation = new Observation(
			[['localhost', 11625]],
			peerNodes,
			mock<CrawlState>()
		);
		observation.moveToSyncingState();
		observation.moveToSyncedState();
		const callback = () => {
			expect(observation.state).toBe(ObservationState.Stopped);
			expect(stragglerTimer.stopStragglerTimeouts).toHaveBeenCalled();
			expect(connectionManager.shutdown).toHaveBeenCalled();
			resolve();
		};
		observationManager.stopObservation(observation, callback);
		expect(observation.state).toBe(ObservationState.Stopping);
		expect(consensusTimer.stop).toHaveBeenCalled();
		expect(
			stragglerTimer.startStragglerTimeoutForActivePeers
		).toHaveBeenCalled();
		expect(stragglerTimer.startStragglerTimeoutForActivePeers).toBeCalledWith(
			true,
			observation.topTierAddressesSet,
			expect.any(Function)
		);

		const onLastNodesDisconnected = stragglerTimer
			.startStragglerTimeoutForActivePeers.mock.calls[0][2] as () => void;
		onLastNodesDisconnected();
	});

	it('should handle ledger close confirmed', () => {
		const peerNodes = new PeerNodeCollection();
		const observation = new Observation(
			[['localhost', 11625]],
			peerNodes,
			mock<CrawlState>()
		);
		observation.moveToSyncingState();
		observation.moveToSyncedState();
		observationManager.ledgerCloseConfirmed(observation, {} as any);
		expect(
			stragglerTimer.startStragglerTimeoutForActivePeers
		).toHaveBeenCalled();
		expect(consensusTimer.start).toHaveBeenCalled();
	});

	it('should handle network halted', async () => {
		const peerNodes = new PeerNodeCollection();
		const observation = new Observation(
			[['localhost', 11625]],
			peerNodes,
			mock<CrawlState>()
		);
		await observationManager.startSync(observation);
		expect(observation.networkHalted).toBe(false);
		const networkHaltedCallback = consensusTimer.start.mock
			.calls[0][0] as () => void;
		networkHaltedCallback();
		expect(observation.networkHalted).toBe(true);
		expect(
			stragglerTimer.startStragglerTimeoutForActivePeers
		).toHaveBeenCalled();
	});
});
