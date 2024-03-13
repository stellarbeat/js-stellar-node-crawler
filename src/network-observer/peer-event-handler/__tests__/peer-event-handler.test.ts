import { mock } from 'jest-mock-extended';
import {
	ClosePayload,
	ConnectedPayload,
	DataPayload
} from '../../connection-manager';
import { SyncState } from '../../network-observer';
import { OnPeerConnected } from '../on-peer-connected';
import { OnPeerConnectionClosed } from '../on-peer-connection-closed';
import { OnPeerData } from '../on-peer-data';
import { PeerEventHandler } from '../peer-event-handler';

describe('PeerConnectionEventHandler', () => {
	const onConnectedHandler = mock<OnPeerConnected>();
	const onConnectionCloseHandler = mock<OnPeerConnectionClosed>();
	const onPeerDataHandler = mock<OnPeerData>();
	const peerConnectionEventHandler = new PeerEventHandler(
		onConnectedHandler,
		onConnectionCloseHandler,
		onPeerDataHandler
	);

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('should call onConnectedHandler.handle', () => {
		const data = mock<ConnectedPayload>();
		const syncState = mock<SyncState>();
		peerConnectionEventHandler.onConnected(data, syncState);
		expect(onConnectedHandler.handle).toHaveBeenCalledWith(data, syncState);
	});

	it('should call onConnectionCloseHandler.handle', () => {
		const data = mock<ClosePayload>();
		const syncState = mock<SyncState>();
		peerConnectionEventHandler.onConnectionClose(data, syncState);
		expect(onConnectionCloseHandler.handle).toHaveBeenCalledWith(
			data,
			syncState
		);
	});

	it('should call onPeerDataHandler.handle', () => {
		const data = mock<DataPayload>();
		const syncState = mock<SyncState>();
		peerConnectionEventHandler.onData(data, syncState);
		expect(onPeerDataHandler.handle).toHaveBeenCalledWith(data, syncState);
	});
});
