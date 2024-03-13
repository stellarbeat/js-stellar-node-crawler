import { mock } from 'jest-mock-extended';
import { CrawlState } from '../../../crawl-state';
import { QuorumSetManager } from '../../quorum-set-manager';
import { P } from 'pino';
import { OnPeerConnectionClosed } from '../on-peer-connection-closed';
import { SyncState } from '../../network-observer';

describe('OnConnectionCloseHandler', () => {
	const quorumSetManager = mock<QuorumSetManager>();
	const logger = mock<P.Logger>();

	beforeEach(() => {
		jest.clearAllMocks();
	});

	function createConnectionCloseHandler() {
		return new OnPeerConnectionClosed(quorumSetManager, logger);
	}

	it('should stop quorum requests', () => {
		const onConnectionCloseHandler = createConnectionCloseHandler();
		const data = {
			publicKey: 'publicKey',
			address: 'address'
		};
		const syncState = mock<SyncState>();
		const crawlState = mock<CrawlState>();
		syncState.crawlState = crawlState;
		syncState.topTierAddresses = new Set();
		onConnectionCloseHandler.handle(data, syncState);
		expect(quorumSetManager.onNodeDisconnected).toHaveBeenCalledWith(
			data.publicKey,
			crawlState
		);
	});
});
