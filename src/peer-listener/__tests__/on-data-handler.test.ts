import { ConnectionManager, DataPayload } from '../../connection-manager';
import { StellarMessageHandler } from '../stellar-message-handlers/stellar-message-handler';
import { mock } from 'jest-mock-extended';
import { P } from 'pino';
import { CrawlState } from '../../crawl-state';
import { createDummyExternalizeMessage } from '../../__fixtures__/createDummyExternalizeMessage';
import { err, ok } from 'neverthrow';
import { PeerListener } from '../peer-listener';
import { QuorumSetManager } from '../quorum-set-manager';

describe('OnDataHandler', () => {
	const connectionManager = mock<ConnectionManager>();
	const quorumSetManager = mock<QuorumSetManager>();
	const stellarMessageHandler = mock<StellarMessageHandler>();
	const logger = mock<P.Logger>();

	beforeEach(() => {
		jest.clearAllMocks();
	});

	function createDataHandler() {
		return new PeerListener(
			connectionManager,
			quorumSetManager,
			stellarMessageHandler,
			logger
		);
	}

	it('should handle data', () => {
		const onDataHandler = createDataHandler();
		const data: DataPayload = {
			publicKey: 'publicKey',
			stellarMessageWork: {
				stellarMessage: createDummyExternalizeMessage(),
				done: jest.fn()
			},
			address: 'address'
		};
		const crawlState = mock<CrawlState>();

		stellarMessageHandler.handleStellarMessage.mockReturnValue(
			ok({
				closedLedger: null,
				peers: []
			})
		);
		onDataHandler.onData(data, crawlState);

		expect(stellarMessageHandler.handleStellarMessage).toHaveBeenCalledWith(
			data.publicKey,
			data.stellarMessageWork.stellarMessage,
			crawlState
		);
		expect(data.stellarMessageWork.done).toHaveBeenCalled();
	});

	it('should handle data error', () => {
		const onDataHandler = createDataHandler();
		const data: DataPayload = {
			publicKey: 'publicKey',
			stellarMessageWork: {
				stellarMessage: createDummyExternalizeMessage(),
				done: jest.fn()
			},
			address: 'address'
		};
		const crawlState = mock<CrawlState>();

		stellarMessageHandler.handleStellarMessage.mockReturnValue(
			err(new Error('error'))
		);
		onDataHandler.onData(data, crawlState);

		expect(stellarMessageHandler.handleStellarMessage).toHaveBeenCalledWith(
			data.publicKey,
			data.stellarMessageWork.stellarMessage,
			crawlState
		);
		expect(data.stellarMessageWork.done).toHaveBeenCalled();
		expect(logger.info).toHaveBeenCalledWith({ peer: data.publicKey }, 'error');
		expect(connectionManager.disconnectByAddress).toHaveBeenCalledWith(
			data.address,
			new Error('error')
		);
	});
});
