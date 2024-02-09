import { StellarMessageHandler } from '../src/stellar-message-handler';
import { ScpManager } from '../src/scp-manager';
import { QuorumSetManager } from '../src/quorum-set-manager';
import { P } from 'pino';
import { StellarMessageWork } from '@stellarbeat/js-stellar-node-connector/lib/connection/connection';
import { CrawlState } from '../src/crawl-state';
import { Keypair } from '@stellar/stellar-base';
import { mock, MockProxy } from 'jest-mock-extended';
import { createDummyExternalizeMessage } from '../fixtures/createDummyExternalizeMessage';
import { ok } from 'neverthrow';
import { createDummyPeersMessage } from '../fixtures/createDummyPeersMessage';
import { createDummyQuorumSetMessage } from '../fixtures/createDummyQuorumSetMessage';
import { createDummyDontHaveMessage } from '../fixtures/createDummyDontHaveMessage';
import { createDummyErrLoadMessage } from '../fixtures/createDummyErrLoadMessage';
import { PeerNodeCollection } from '../src/peer-node-collection';
import { PeerNode } from '../src';

describe('StellarMessageHandler', () => {
	let scpManager: MockProxy<ScpManager>;
	let quorumSetManager: MockProxy<QuorumSetManager>;
	let logger: MockProxy<P.Logger>;
	let handler: StellarMessageHandler;
	let peerNode: PeerNode;

	beforeEach(() => {
		scpManager = mock<ScpManager>();
		quorumSetManager = mock<QuorumSetManager>();
		logger = mock<P.Logger>();
		handler = new StellarMessageHandler(scpManager, quorumSetManager, logger);
		peerNode = new PeerNode('A');
	});

	describe('handleStellarMessage', () => {
		it('should handle SCP message', () => {
			const keyPair = Keypair.random();
			const stellarMessageWork = {
				stellarMessage: createDummyExternalizeMessage(keyPair),
				done: jest.fn()
			} as StellarMessageWork;
			const crawlState = mock<CrawlState>();
			scpManager.processScpEnvelope.mockReturnValueOnce(ok(undefined));
			handler.handleStellarMessage(peerNode, stellarMessageWork, crawlState);

			expect(scpManager.processScpEnvelope).toHaveBeenCalledTimes(1);
			expect(stellarMessageWork.done).toHaveBeenCalled();
		});

		it('should handle peers message', () => {
			const stellarMessageWork = {
				stellarMessage: createDummyPeersMessage(),
				done: jest.fn()
			} as StellarMessageWork;
			const crawlState = mock<CrawlState>();
			const peerAddressesListener = jest.fn();
			handler.on('peerAddresses', peerAddressesListener);

			handler.handleStellarMessage(peerNode, stellarMessageWork, crawlState);
			expect(peerAddressesListener).toHaveBeenCalledTimes(1);
			expect(stellarMessageWork.done).toHaveBeenCalled();
		});

		it('should handle SCP quorum set message', () => {
			const stellarMessageWork = {
				stellarMessage: createDummyQuorumSetMessage(),
				done: jest.fn()
			} as StellarMessageWork;
			const crawlState = mock<CrawlState>();
			handler.handleStellarMessage(peerNode, stellarMessageWork, crawlState);
			expect(quorumSetManager.processQuorumSet).toHaveBeenCalledTimes(1);
			expect(stellarMessageWork.done).toHaveBeenCalled();
		});

		it('should handle dont have message', () => {
			const stellarMessageWork = {
				stellarMessage: createDummyDontHaveMessage(),
				done: jest.fn()
			} as StellarMessageWork;
			const crawlState = mock<CrawlState>();
			handler.handleStellarMessage(peerNode, stellarMessageWork, crawlState);
			expect(
				quorumSetManager.peerNodeDoesNotHaveQuorumSet
			).toHaveBeenCalledTimes(1);
			expect(stellarMessageWork.done).toHaveBeenCalled();
		});

		it('should handle errLoad message', () => {
			const stellarMessageWork = {
				stellarMessage: createDummyErrLoadMessage(),
				done: jest.fn()
			} as StellarMessageWork;
			const crawlState = mock<CrawlState>();
			crawlState.peerNodes = new PeerNodeCollection();
			handler.handleStellarMessage(peerNode, stellarMessageWork, crawlState);
			expect(stellarMessageWork.done).toHaveBeenCalled();
		});
	});

	// Add more tests for other methods...
});
