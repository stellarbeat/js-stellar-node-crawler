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
import { CrawlState } from '../../crawl-state';
import { NodeAddress } from '../../node-address';
import { ObservationFactory } from '../observation-factory';
import { Observation } from '../observation';
import { ObservationState } from '../observation-state';
import { EventEmitter } from 'events';
import { Ledger } from '../../crawler';
import { nextTick } from 'async';

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

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('should observe', async () => {
		const topTierNodes: NodeAddress[] = [];
		connectionManager.getNumberOfActiveConnections.mockReturnValue(1);
		const observation = mock<Observation>();
		observationFactory.createObservation.mockReturnValue(observation);
		const crawlState = mock<CrawlState>();
		const result = await networkObserver.observe(topTierNodes, crawlState);
		expect(result).toBe(1);
		expect(observationFactory.createObservation).toHaveBeenCalled();
		expect(observationManager.startSync).toHaveBeenCalledWith(observation);
	});

	it('should connect to node', async () => {
		const ip = 'localhost';
		const port = 11625;
		const observation = new Observation([['localhost', 11625]], mock(), mock());
		observation.state = ObservationState.Synced;
		observationFactory.createObservation.mockReturnValue(observation);
		await networkObserver.observe([mock<NodeAddress>()], mock<CrawlState>());
		networkObserver.connectToNode(ip, port);
		expect(connectionManager.connectToNode).toHaveBeenCalledWith(ip, port);
	});

	it('should stop', async () => {
		const observation = new Observation([['localhost', 11625]], mock(), mock());
		observation.state = ObservationState.Synced;
		observationFactory.createObservation.mockReturnValue(observation);
		await networkObserver.observe([mock<NodeAddress>()], mock<CrawlState>());
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
		const observation = new Observation([['localhost', 11625]], mock(), mock());
		observation.state = ObservationState.Synced;
		observationFactory.createObservation.mockReturnValue(observation);
		await networkObserver.observe([mock<NodeAddress>()], mock<CrawlState>());
		connectionManagerEmitter.emit('data', data);
		expect(peerEventHandler.onData).toHaveBeenCalledWith(data, observation);
	});

	it('should handle closed ledger through peer data event', async () => {
		const data = mock<DataPayload>();
		peerEventHandler.onData.mockReturnValue({
			closedLedger: mock<Ledger>(),
			peers: []
		});
		const observation = new Observation([['localhost', 11625]], mock(), mock());
		observation.state = ObservationState.Synced;
		observationFactory.createObservation.mockReturnValue(observation);
		await networkObserver.observe([mock<NodeAddress>()], mock<CrawlState>());
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
		const observation = new Observation([['localhost', 11625]], mock(), mock());
		networkObserver.on('peers', (peers) => {
			expect(peers).toEqual([['localhost', 11625]]);
		});
		observation.state = ObservationState.Synced;
		observationFactory.createObservation.mockReturnValue(observation);
		await networkObserver.observe([mock<NodeAddress>()], mock<CrawlState>());
		connectionManagerEmitter.emit('data', data);
		expect(peerEventHandler.onData).toHaveBeenCalledWith(data, observation);
		expect(observationManager.ledgerCloseConfirmed).not.toHaveBeenCalled();
		nextTick(() => {}); //to make sure event is checked
	});

	it('should handle connected event', async () => {
		const data = mock<DataPayload>();
		const observation = new Observation([['localhost', 11625]], mock(), mock());
		observation.state = ObservationState.Synced;
		observationFactory.createObservation.mockReturnValue(observation);
		await networkObserver.observe([mock<NodeAddress>()], mock<CrawlState>());
		connectionManagerEmitter.emit('connected', data);
		expect(peerEventHandler.onConnected).toHaveBeenCalledWith(
			data,
			observation
		);
	});

	it('should handle close event', async () => {
		const data = mock<DataPayload>();
		const observation = new Observation([['localhost', 11625]], mock(), mock());
		observation.state = ObservationState.Synced;
		observationFactory.createObservation.mockReturnValue(observation);
		networkObserver.on('disconnect', (close: ClosePayload) => {
			expect(close).toEqual(data);
		});
		await networkObserver.observe([mock<NodeAddress>()], mock<CrawlState>());
		connectionManagerEmitter.emit('close', data);
		expect(peerEventHandler.onConnectionClose).toHaveBeenCalledWith(
			data,
			observation
		);
		nextTick(() => {}); //to make sure close event is checked
	});
});
