import { PeerNodeCollection } from '../../../peer-node-collection';
import { mock, MockProxy } from 'jest-mock-extended';
import { P } from 'pino';
import { ConnectedPayload, ConnectionManager } from '../../connection-manager';
import { StragglerTimer } from '../../straggler-timer';
import { OnPeerConnected } from '../on-peer-connected';
import { Observation } from '../../observation';
import { ObservationState } from '../../observation-state';
import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { Ledger } from '../../../crawler';
import { Slots } from '../stellar-message-handlers/scp-envelope/scp-statement/externalize/slots';

describe('OnPeerConnectedHandler', () => {
	const connectionManager = mock<ConnectionManager>();
	const stragglerHandler = mock<StragglerTimer>();

	beforeEach(() => {
		jest.clearAllMocks();
	});

	const createOnConnectedHandler = () => {
		return new OnPeerConnected(
			stragglerHandler,
			connectionManager,
			mock<P.Logger>()
		);
	};
	const createObservation = (): Observation => {
		return new Observation(
			'test',
			[],
			mock<PeerNodeCollection>(),
			mock<Ledger>(),
			new Map<string, QuorumSet>(),
			new Slots(new QuorumSet(1, ['A'], []), mock<P.Logger>())
		);
	};

	const createData = (): ConnectedPayload => {
		return {
			ip: 'localhost',
			port: 11625,
			publicKey: 'publicKey',
			nodeInfo: {
				overlayVersion: 3,
				overlayMinVersion: 1,
				networkId: 'networkId',
				ledgerVersion: 2,
				versionString: 'versionString'
			}
		};
	};

	function assertPeerSuccessfullyConnected(
		peerNodes: PeerNodeCollection,
		data: ConnectedPayload
	) {
		expect(peerNodes.addSuccessfullyConnected).toHaveBeenCalledWith(
			data.publicKey,
			data.ip,
			data.port,
			data.nodeInfo
		);

		expect(connectionManager.disconnectByAddress).not.toBeCalled();
	}

	it('should handle a successful connection in SYNCING state', () => {
		const onConnectedHandler = createOnConnectedHandler();
		const data = createData();
		const observation = createObservation();
		observation.state = ObservationState.Syncing;
		onConnectedHandler.handle(data, observation);

		assertPeerSuccessfullyConnected(observation.peerNodes, data);
	});

	it('should handle a successful connection in SYNCED state', () => {
		const onConnectedHandler = createOnConnectedHandler();
		const data = createData();
		const observation = createObservation();
		observation.state = ObservationState.Synced;
		onConnectedHandler.handle(data, observation);

		assertPeerSuccessfullyConnected(observation.peerNodes, data);
	});

	function assertDisconnected(
		data: ConnectedPayload,
		observation: Observation,
		error?: Error
	) {
		expect(observation.peerNodes.addSuccessfullyConnected).toBeCalled();
		expect(connectionManager.disconnectByAddress).toBeCalledWith(
			data.ip + ':' + data.port,
			error
		);
		expect(stragglerHandler.startStragglerTimeout).not.toBeCalled();
	}

	it('should refuse connection in IDLE state', () => {
		const onConnectedHandler = createOnConnectedHandler();
		const data = createData();
		const observation = createObservation();
		observation.state = ObservationState.Idle;
		onConnectedHandler.handle(data, observation);
		assertDisconnected(data, observation, new Error('Connected while idle'));
	});

	function assertStragglerTimeoutStarted(data: ConnectedPayload) {
		expect(stragglerHandler.startStragglerTimeout).toHaveBeenCalledWith([
			data.ip + ':' + data.port
		]);
	}

	it('should start straggler timeout in STOPPING state', () => {
		const onConnectedHandler = createOnConnectedHandler();
		const data = createData();
		const observation = createObservation();
		observation.state = ObservationState.Stopping;
		onConnectedHandler.handle(data, observation);
		assertPeerSuccessfullyConnected(observation.peerNodes, data);
		assertStragglerTimeoutStarted(data);
	});

	it('should start straggler timeout if network is halted ', () => {
		const onConnectedHandler = createOnConnectedHandler();
		const data = createData();
		const observation = createObservation();
		observation.state = ObservationState.Synced;
		observation.networkHalted = true;
		onConnectedHandler.handle(data, observation);
		assertPeerSuccessfullyConnected(observation.peerNodes, data);
		assertStragglerTimeoutStarted(data);
	});

	it('should disconnect if Peer not valid', () => {
		const onConnectedHandler = createOnConnectedHandler();
		const data = createData();
		const observation = createObservation();
		const error = new Error('error');
		(
			observation.peerNodes as MockProxy<PeerNodeCollection>
		).addSuccessfullyConnected.mockReturnValue(error);
		onConnectedHandler.handle(data, observation);

		assertDisconnected(data, observation, error);
	});
});
