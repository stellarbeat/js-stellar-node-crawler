import { mock } from 'jest-mock-extended';
import { ConnectionManager } from '../../connection-manager';
import { CrawlQueueManager } from '../../crawl-queue-manager';
import { DisconnectTimeout } from '../../disconnect-timeout';
import { OnConnectionCloseHandler } from '../on-connection-close-handler';
import { CrawlState } from '../../crawl-state';
import { QuorumSetManager } from '../../quorum-set-manager';
import { PeerNodeCollection } from '../../peer-node-collection';

describe('OnConnectionCloseHandler', () => {
	const queueManager = mock<CrawlQueueManager>();
	const quorumSetManager = mock<QuorumSetManager>();

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('should cleanup a closed connection', () => {
		const onConnectionCloseHandler = new OnConnectionCloseHandler(
			quorumSetManager,
			queueManager
		);
		const address = 'localhost:11625';
		const publicKey: string = 'publicKey';
		const crawlState = mock<CrawlState>();
		crawlState.listenTimeouts = new Map();
		const spy = jest.spyOn(crawlState.listenTimeouts, 'delete');
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
		expect(queueManager.completeCrawlQueueTask).toHaveBeenCalledWith(
			crawlState.crawlQueueTaskDoneCallbacks,
			address
		);
		expect(spy).toHaveBeenCalledWith(publicKey);

		expect(peer.disconnected).toBe(true);
		expect(peer.disconnectionTime).toBe(localTime);
	});

	it('should update failed connections', () => {
		const onConnectionCloseHandler = new OnConnectionCloseHandler(
			quorumSetManager,
			queueManager
		);
		const address = 'localhost:11625';
		const crawlState = mock<CrawlState>();
		crawlState.failedConnections = [];
		onConnectionCloseHandler.onConnectionClose(
			address,
			undefined,
			crawlState,
			new Date()
		);
		expect(crawlState.failedConnections).toEqual([address]);
	});
});
