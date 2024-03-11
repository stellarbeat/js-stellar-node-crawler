import { PeerNodeCollection } from '../../peer-node-collection';
import { mock } from 'jest-mock-extended';
import { ConnectedPayload, ConnectionManager } from '../../connection-manager';
import { P } from 'pino';
import { PeerListener } from '../peer-listener';
import { QuorumSetManager } from '../quorum-set-manager';
import { StellarMessageHandler } from '../stellar-message-handlers/stellar-message-handler';

describe('OnConnectedHandler', () => {
	const connectionManager = mock<ConnectionManager>();
	const quorumSetManager = mock<QuorumSetManager>();
	const stellarMessageHandler = mock<StellarMessageHandler>();

	beforeEach(() => {
		jest.clearAllMocks();
	});

	const createOnConnectedHandler = () => {
		return new PeerListener(
			connectionManager,
			quorumSetManager,
			stellarMessageHandler,
			mock<P.Logger>()
		);
	};

	it('should handle a successful connection', () => {
		const onConnectedHandler = createOnConnectedHandler();
		const data: ConnectedPayload = {
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
		const peerNodes = mock<PeerNodeCollection>();
		const localTime = new Date();
		onConnectedHandler.onConnected(data, peerNodes, false, localTime);

		expect(peerNodes.addSuccessfullyConnected).toHaveBeenCalledWith(
			data.publicKey,
			data.ip,
			data.port,
			data.nodeInfo,
			localTime
		);
	});

	it('should handle a peer node error', () => {
		const onConnectedHandler = createOnConnectedHandler();
		const data: ConnectedPayload = {
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
		const peerNodes = mock<PeerNodeCollection>();
		const localTime = new Date();
		const error = new Error('error');
		peerNodes.addSuccessfullyConnected.mockReturnValue(error);
		onConnectedHandler.onConnected(data, peerNodes, false, localTime);

		expect(peerNodes.addSuccessfullyConnected).toHaveBeenCalledWith(
			data.publicKey,
			data.ip,
			data.port,
			data.nodeInfo,
			localTime
		);
		expect(connectionManager.disconnectByAddress).toHaveBeenCalledWith(
			`${data.ip}:${data.port}`,
			error
		);
	});
});
