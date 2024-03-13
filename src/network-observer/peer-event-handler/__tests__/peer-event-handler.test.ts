import { mock } from 'jest-mock-extended';
import {
	ClosePayload,
	ConnectedPayload,
	DataPayload
} from '../../connection-manager';
import { OnPeerConnected } from '../on-peer-connected';
import { OnPeerConnectionClosed } from '../on-peer-connection-closed';
import { OnPeerData } from '../on-peer-data';
import { PeerEventHandler } from '../peer-event-handler';
import { Observation } from '../../observation';

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
		const observation = mock<Observation>();
		peerConnectionEventHandler.onConnected(data, observation);
		expect(onConnectedHandler.handle).toHaveBeenCalledWith(data, observation);
	});

	it('should call onConnectionCloseHandler.handle', () => {
		const data = mock<ClosePayload>();
		const observation = mock<Observation>();
		peerConnectionEventHandler.onConnectionClose(data, observation);
		expect(onConnectionCloseHandler.handle).toHaveBeenCalledWith(
			data,
			observation
		);
	});

	it('should call onPeerDataHandler.handle', () => {
		const data = mock<DataPayload>();
		const observation = mock<Observation>();
		peerConnectionEventHandler.onData(data, observation);
		expect(onPeerDataHandler.handle).toHaveBeenCalledWith(data, observation);
	});
});
