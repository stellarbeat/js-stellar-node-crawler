import { PeerNodeCollection } from '../../peer-node-collection';
import { mock } from 'jest-mock-extended';
import { ConnectedPayload, ConnectionManager } from '../../connection-manager';
import { CrawlQueueManager } from '../../crawl-queue-manager';
import { DisconnectTimeout } from '../../disconnect-timeout';
import { OnConnectedHandler } from '../on-connected-handler';
import { P } from 'pino';

describe('OnConnectedHandler', () => {
	const connectionManager = mock<ConnectionManager>();
	const crawlQueueManager = mock<CrawlQueueManager>();
	const disconnectTimeout = mock<DisconnectTimeout>();

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('should handle a successful connection', () => {
		const onConnectedHandler = new OnConnectedHandler(
			connectionManager,
			crawlQueueManager,
			disconnectTimeout,
			mock<P.Logger>()
		);
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
		const topTierNodes: Set<string> = new Set();
		const listenTimeouts = new Map();
		const localTime = new Date();
		onConnectedHandler.onConnected(
			data,
			peerNodes,
			topTierNodes,
			listenTimeouts,
			localTime
		);

		expect(peerNodes.addSuccessfullyConnected).toHaveBeenCalledWith(
			data.publicKey,
			data.ip,
			data.port,
			data.nodeInfo,
			localTime
		);
		expect(disconnectTimeout.start).toHaveBeenCalled();
	});

	it('should handle a peer node error', () => {
		const onConnectedHandler = new OnConnectedHandler(
			connectionManager,
			crawlQueueManager,
			disconnectTimeout,
			mock<P.Logger>()
		);
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
		const topTierNodes: Set<string> = new Set();
		const listenTimeouts = new Map();
		const localTime = new Date();
		const error = new Error('error');
		peerNodes.addSuccessfullyConnected.mockReturnValue(error);
		onConnectedHandler.onConnected(
			data,
			peerNodes,
			topTierNodes,
			listenTimeouts,
			localTime
		);

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
