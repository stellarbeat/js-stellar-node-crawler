import { PeerNodeCollection } from '../../../peer-node-collection';
import { mock, MockProxy } from 'jest-mock-extended';
import { P } from 'pino';
import { ConnectedPayload, ConnectionManager } from '../../connection-manager';
import { StragglerTimer } from '../../straggler-timer';
import { NetworkObserverState, SyncState } from '../../network-observer';
import { CrawlState } from '../../../crawl-state';
import { OnPeerConnected } from '../on-peer-connected';

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
	const createState = (): SyncState => {
		return {
			state: NetworkObserverState.Idle,
			networkHalted: false,
			topTierAddresses: new Set(),
			peerNodes: mock<PeerNodeCollection>(),
			crawlState: mock<CrawlState>()
		};
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
		const state = createState();
		state.state = NetworkObserverState.Syncing;
		onConnectedHandler.handle(data, state);

		assertPeerSuccessfullyConnected(state.peerNodes, data);
	});

	it('should handle a successful connection in SYNCED state', () => {
		const onConnectedHandler = createOnConnectedHandler();
		const data = createData();
		const state = createState();
		state.state = NetworkObserverState.Synced;
		onConnectedHandler.handle(data, state);

		assertPeerSuccessfullyConnected(state.peerNodes, data);
	});

	function assertDisconnected(
		data: ConnectedPayload,
		state: SyncState,
		error?: Error
	) {
		expect(state.peerNodes.addSuccessfullyConnected).toBeCalled();
		expect(connectionManager.disconnectByAddress).toBeCalledWith(
			data.ip + ':' + data.port,
			error
		);
		expect(stragglerHandler.startStragglerTimeout).not.toBeCalled();
	}

	it('should refuse connection in IDLE state', () => {
		const onConnectedHandler = createOnConnectedHandler();
		const data = createData();
		const state = createState();
		state.state = NetworkObserverState.Idle;
		onConnectedHandler.handle(data, state);
		assertDisconnected(data, state, new Error('Connected while idle'));
	});

	function assertStragglerTimeoutStarted(data: ConnectedPayload) {
		expect(stragglerHandler.startStragglerTimeout).toHaveBeenCalledWith([
			data.ip + ':' + data.port
		]);
	}

	it('should start straggler timeout in STOPPING state', () => {
		const onConnectedHandler = createOnConnectedHandler();
		const data = createData();
		const state = createState();
		state.state = NetworkObserverState.Stopping;
		onConnectedHandler.handle(data, state);
		assertPeerSuccessfullyConnected(state.peerNodes, data);
		assertStragglerTimeoutStarted(data);
	});

	it('should start straggler timeout if network is halted ', () => {
		const onConnectedHandler = createOnConnectedHandler();
		const data = createData();
		const state = createState();
		state.state = NetworkObserverState.Synced;
		state.networkHalted = true;
		onConnectedHandler.handle(data, state);
		assertPeerSuccessfullyConnected(state.peerNodes, data);
		assertStragglerTimeoutStarted(data);
	});

	it('should disconnect if Peer not valid', () => {
		const onConnectedHandler = createOnConnectedHandler();
		const data = createData();
		const state = createState();
		const error = new Error('error');
		(
			state.peerNodes as MockProxy<PeerNodeCollection>
		).addSuccessfullyConnected.mockReturnValue(error);
		onConnectedHandler.handle(data, state);

		assertDisconnected(data, state, error);
	});
});
