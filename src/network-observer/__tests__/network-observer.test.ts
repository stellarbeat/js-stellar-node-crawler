import { NetworkObserver } from '../network-observer';
import { mock } from 'jest-mock-extended';
import { P } from 'pino';
import {
	ClosePayload,
	ConnectionManager,
	DataPayload
} from '../connection-manager';
import { QuorumSetManager } from '../quorum-set-manager';
import { PeerEventHandler } from '../peer-event-handler/peer-event-handler';
import { ObservationManager } from '../observation-manager';
import { NodeAddress } from '../../node-address';
import { ObservationFactory } from '../observation-factory';
import { Observation } from '../observation';
import { ObservationState } from '../observation-state';
import { EventEmitter } from 'events';
import { Ledger } from '../../crawler';
import { nextTick } from 'async';
import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { PeerNodeCollection } from '../../peer-node-collection';
import { Slots } from '../peer-event-handler/stellar-message-handlers/scp-envelope/scp-statement/externalize/slots';

describe('network-observer', () => {
	const observationFactory = mock<ObservationFactory>();
	const connectionManager = mock<ConnectionManager>();
	const connectionManagerEmitter = new EventEmitter();
	connectionManager.on.mockImplementation((event, listener) => {
		connectionManagerEmitter.on(event, listener);
		return connectionManager;
	});
	const quorumSetManager = mock<QuorumSetManager>();
	const peerEventHandler = mock<PeerEventHandler>();
	const observationManager = mock<ObservationManager>();

	const networkObserver = new NetworkObserver(
		observationFactory,
		connectionManager,
		quorumSetManager,
		peerEventHandler,
		observationManager
	);

	const createObservation = (topTierAddresses: NodeAddress[] = []) => {
		return new Observation(
			'test',
			topTierAddresses,
			mock<PeerNodeCollection>(),
			mock<Ledger>(),
			new Map<string, QuorumSet>(),
			new Slots(new QuorumSet(1, ['A'], []), mock<P.Logger>())
		);
	};

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('should observe', async () => {
		connectionManager.getNumberOfActiveConnections.mockReturnValue(1);
		const observation = createObservation();
		observationFactory.createObservation.mockReturnValue(observation);
		const result = await networkObserver.startObservation(observation);
		expect(result).toBe(1);
		expect(observationManager.startSync).toHaveBeenCalledWith(observation);
	});

	it('should connect to node', async () => {
		const ip = 'localhost';
		const port = 11625;
		const observation = createObservation([['localhost', 11625]]);
		observation.state = ObservationState.Synced;
		observationFactory.createObservation.mockReturnValue(observation);
		await networkObserver.startObservation(observation);
		networkObserver.connectToNode(ip, port);
		expect(connectionManager.connectToNode).toHaveBeenCalledWith(ip, port);
	});

	it('should stop', async () => {
		const observation = createObservation([['localhost', 11625]]);
		observation.state = ObservationState.Synced;
		observationFactory.createObservation.mockReturnValue(observation);
		await networkObserver.startObservation(observation);
		observationManager.stopObservation.mockImplementation((observation, cb) => {
			cb();
		});
		const result = await networkObserver.stop();
		expect(result).toBe(observation);
	});

	it('should handle peer data', async () => {
		const data = mock<DataPayload>();
		peerEventHandler.onData.mockReturnValue({
			closedLedger: null,
			peers: []
		});
		const observation = createObservation();
		observation.state = ObservationState.Synced;
		observationFactory.createObservation.mockReturnValue(observation);
		await networkObserver.startObservation(observation);
		connectionManagerEmitter.emit('data', data);
		expect(peerEventHandler.onData).toHaveBeenCalledWith(data, observation);
	});

	it('should handle closed ledger through peer data event', async () => {
		const data = mock<DataPayload>();
		peerEventHandler.onData.mockReturnValue({
			closedLedger: mock<Ledger>(),
			peers: []
		});
		const observation = createObservation();
		observation.state = ObservationState.Synced;
		observationFactory.createObservation.mockReturnValue(observation);
		await networkObserver.startObservation(observation);
		connectionManagerEmitter.emit('data', data);
		expect(peerEventHandler.onData).toHaveBeenCalledWith(data, observation);
		expect(observationManager.ledgerCloseConfirmed).toHaveBeenCalledWith(
			observation,
			peerEventHandler.onData(data, observation).closedLedger
		);
	});

	it('should emit peers event through peer data event', async () => {
		const data = mock<DataPayload>();
		peerEventHandler.onData.mockReturnValue({
			closedLedger: null,
			peers: [['localhost', 11625]]
		});
		const observation = createObservation();
		networkObserver.on('peers', (peers) => {
			expect(peers).toEqual([['localhost', 11625]]);
		});
		observation.state = ObservationState.Synced;
		observationFactory.createObservation.mockReturnValue(observation);
		await networkObserver.startObservation(observation);
		connectionManagerEmitter.emit('data', data);
		expect(peerEventHandler.onData).toHaveBeenCalledWith(data, observation);
		expect(observationManager.ledgerCloseConfirmed).not.toHaveBeenCalled();
		nextTick(() => {}); //to make sure event is checked
	});

	it('should handle connected event', async () => {
		const data = mock<DataPayload>();
		const observation = createObservation();
		observation.state = ObservationState.Synced;
		observationFactory.createObservation.mockReturnValue(observation);
		await networkObserver.startObservation(observation);
		connectionManagerEmitter.emit('connected', data);
		expect(peerEventHandler.onConnected).toHaveBeenCalledWith(
			data,
			observation
		);
	});

	it('should handle close event', async () => {
		const data = mock<DataPayload>();
		const observation = createObservation();
		observation.state = ObservationState.Synced;
		observationFactory.createObservation.mockReturnValue(observation);
		networkObserver.on('disconnect', (close: ClosePayload) => {
			expect(close).toEqual(data);
		});
		await networkObserver.startObservation(observation);
		connectionManagerEmitter.emit('close', data);
		expect(peerEventHandler.onConnectionClose).toHaveBeenCalledWith(
			data,
			observation
		);
		nextTick(() => {}); //to make sure close event is checked
	});
});
