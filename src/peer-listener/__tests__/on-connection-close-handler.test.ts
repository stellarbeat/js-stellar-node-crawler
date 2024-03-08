import { mock } from 'jest-mock-extended';
import { CrawlQueueManager } from '../../crawl-queue-manager';
import { CrawlState } from '../../crawl-state';
import { QuorumSetManager } from '../quorum-set-manager';
import { PeerNodeCollection } from '../../peer-node-collection';
import { P } from 'pino';
import { PeerListenTimeoutManager } from '../peer-listen-timeout-manager';
import { PeerListener } from '../peer-listener';
import { ConnectionManager } from '../../connection-manager';
import { StellarMessageHandler } from '../stellar-message-handlers/stellar-message-handler';

describe('OnConnectionCloseHandler', () => {
	const queueManager = mock<CrawlQueueManager>();
	const quorumSetManager = mock<QuorumSetManager>();
	const connectionManager = mock<ConnectionManager>();
	const stellarMessageHandler = mock<StellarMessageHandler>();
	const logger = mock<P.Logger>();
	const peerListenTimeoutManager = mock<PeerListenTimeoutManager>();

	beforeEach(() => {
		jest.clearAllMocks();
	});

	function createConnectionCloseHandler() {
		return new PeerListener(
			connectionManager,
			quorumSetManager,
			stellarMessageHandler,
			peerListenTimeoutManager,
			logger
		);
	}

	it('should cleanup a closed connection', () => {
		const onConnectionCloseHandler = createConnectionCloseHandler();
		const address = 'localhost:11625';
		const publicKey: string = 'publicKey';
		const crawlState = mock<CrawlState>();
		crawlState.topTierNodes = new Set();
		crawlState.peerNodes = new PeerNodeCollection();
		const peer = crawlState.peerNodes.addSuccessfullyConnected(
			publicKey,
			'localhost',
			11625,
			{
				overlayVersion: 3,
				overlayMinVersion: 1,
				networkId: 'networkId',
				ledgerVersion: 2,
				versionString: 'versionString'
			},
			new Date()
		);
		if (peer instanceof Error) {
			throw peer;
		}
		const localTime = new Date();

		onConnectionCloseHandler.onConnectionClose(
			address,
			publicKey,
			crawlState,
			localTime
		);

		expect(quorumSetManager.onNodeDisconnected).toHaveBeenCalledWith(
			publicKey,
			crawlState
		);

		expect(peerListenTimeoutManager.stopTimer).toHaveBeenCalledWith(peer);

		expect(peer.disconnected).toBe(true);
		expect(peer.disconnectionTime).toBe(localTime);
	});
});