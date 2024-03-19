import { mock } from 'jest-mock-extended';
import { QuorumSetManager } from '../../quorum-set-manager';
import { P } from 'pino';
import { OnPeerConnectionClosed } from '../on-peer-connection-closed';
import { Observation } from '../../observation';

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
		const observation = mock<Observation>();
		observation.topTierAddressesSet = new Set();
		onConnectionCloseHandler.handle(data, observation);
		expect(quorumSetManager.onNodeDisconnected).toHaveBeenCalledWith(
			data.publicKey,
			observation
		);
	});
});
