import { ConnectionManager, DataPayload } from '../../connection-manager';
import { mock } from 'jest-mock-extended';
import { P } from 'pino';
import { OnPeerData } from '../on-peer-data';
import { StellarMessageHandler } from '../stellar-message-handlers/stellar-message-handler';
import { createDummyExternalizeMessage } from '../../../__fixtures__/createDummyExternalizeMessage';
import { CrawlState } from '../../../crawl-state';
import { err, ok } from 'neverthrow';
import { ObservationState } from '../../network-observer';
import { PeerNodeCollection } from '../../../peer-node-collection';
import { Ledger } from '../../../crawler';
import { NodeAddress } from '../../../node-address';
import { Observation } from '../../observation';

describe('OnDataHandler', () => {
	const connectionManager = mock<ConnectionManager>();
	const stellarMessageHandler = mock<StellarMessageHandler>();
	const logger = mock<P.Logger>();

	beforeEach(() => {
		jest.clearAllMocks();
	});

	function createDataHandler() {
		return new OnPeerData(stellarMessageHandler, logger, connectionManager);
	}

	function createObservation(): Observation {
		return new Observation([], mock<PeerNodeCollection>(), mock<CrawlState>());
	}

	function createData() {
		const data: DataPayload = {
			publicKey: 'publicKey',
			stellarMessageWork: {
				stellarMessage: createDummyExternalizeMessage(),
				done: jest.fn()
			},
			address: 'address'
		};
		return data;
	}

	function createSuccessfulResult() {
		const result: {
			closedLedger: Ledger | null;
			peers: Array<NodeAddress>;
		} = {
			closedLedger: {
				sequence: BigInt(1),
				closeTime: new Date(),
				value: 'value',
				localCloseTime: new Date()
			},
			peers: [['address', 11625]]
		};
		return result;
	}

	it('should handle data successfully in Synced state and attempt slot close', () => {
		const onDataHandler = createDataHandler();
		const data = createData();
		const result = createSuccessfulResult();

		stellarMessageHandler.handleStellarMessage.mockReturnValue(ok(result));

		const state = createObservation();
		state.state = ObservationState.Synced;
		const receivedResult = onDataHandler.handle(data, state);

		expect(stellarMessageHandler.handleStellarMessage).toHaveBeenCalledWith(
			data.publicKey,
			data.stellarMessageWork.stellarMessage,
			true,
			state.crawlState
		);
		expect(data.stellarMessageWork.done).toHaveBeenCalled();
		expect(receivedResult).toEqual(result);
	});

	it('should handle data successfully but not attempt slot close if not in synced mode', () => {
		const onDataHandler = createDataHandler();
		const data = createData();
		const state = createObservation();
		state.state = ObservationState.Syncing;
		const result = createSuccessfulResult();
		stellarMessageHandler.handleStellarMessage.mockReturnValue(ok(result));

		const receivedResult = onDataHandler.handle(data, state);

		expect(stellarMessageHandler.handleStellarMessage).toHaveBeenCalledWith(
			data.publicKey,
			data.stellarMessageWork.stellarMessage,
			false,
			state.crawlState
		);
		expect(data.stellarMessageWork.done).toHaveBeenCalled();
		expect(receivedResult).toEqual(result);
	});

	it('should handle data error', () => {
		const onDataHandler = createDataHandler();
		const data = createData();

		stellarMessageHandler.handleStellarMessage.mockReturnValue(
			err(new Error('error'))
		);
		const result = onDataHandler.handle(data, createObservation());
		expect(data.stellarMessageWork.done).toHaveBeenCalled();
		expect(connectionManager.disconnectByAddress).toHaveBeenCalledWith(
			data.address,
			new Error('error')
		);
		expect(result).toEqual({ closedLedger: null, peers: [] });
	});
});
