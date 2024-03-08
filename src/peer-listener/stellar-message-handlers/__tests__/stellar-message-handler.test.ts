import { StellarMessageHandler } from '../stellar-message-handler';
import { ScpEnvelopeHandler } from '../scp-envelope/scp-envelope-handler';
import { QuorumSetManager } from '../../quorum-set-manager';
import { P } from 'pino';
import { CrawlProcessState, CrawlState } from '../../../crawl-state';
import { Keypair } from '@stellar/stellar-base';
import { mock, MockProxy } from 'jest-mock-extended';
import { createDummyExternalizeMessage } from '../../../__fixtures__/createDummyExternalizeMessage';
import { ok } from 'neverthrow';
import { createDummyPeersMessage } from '../../../__fixtures__/createDummyPeersMessage';
import { createDummyQuorumSetMessage } from '../../../__fixtures__/createDummyQuorumSetMessage';
import { createDummyDontHaveMessage } from '../../../__fixtures__/createDummyDontHaveMessage';
import { createDummyErrLoadMessage } from '../../../__fixtures__/createDummyErrLoadMessage';
import { PeerNodeCollection } from '../../../peer-node-collection';

describe('StellarMessageHandler', () => {
	let scpManager: MockProxy<ScpEnvelopeHandler>;
	let quorumSetManager: MockProxy<QuorumSetManager>;
	let logger: MockProxy<P.Logger>;
	let handler: StellarMessageHandler;
	let senderPublicKey: string;

	beforeEach(() => {
		scpManager = mock<ScpEnvelopeHandler>();
		quorumSetManager = mock<QuorumSetManager>();
		logger = mock<P.Logger>();
		handler = new StellarMessageHandler(scpManager, quorumSetManager, logger);
		senderPublicKey = 'A';
	});

	describe('handleStellarMessage', () => {
		it('should handle SCP message in crawl state', () => {
			const keyPair = Keypair.random();
			const stellarMessage = createDummyExternalizeMessage(keyPair);
			const crawlState = mock<CrawlState>();
			crawlState.state = CrawlProcessState.CRAWLING;
			scpManager.handle.mockReturnValueOnce(ok(undefined));
			const result = handler.handleStellarMessage(
				senderPublicKey,
				stellarMessage,
				crawlState
			);
			expect(scpManager.handle).toHaveBeenCalledTimes(1);
			expect(result.isOk()).toBeTruthy();
		});

		it('should not handle SCP message in non-crawl state', () => {
			const stellarMessage = createDummyExternalizeMessage();
			const crawlState = mock<CrawlState>();
			crawlState.state = CrawlProcessState.TOP_TIER_SYNC;
			const result = handler.handleStellarMessage(
				senderPublicKey,
				stellarMessage,
				crawlState
			);
			expect(scpManager.handle).toHaveBeenCalledTimes(0);
			expect(result.isOk()).toBeTruthy();
		});

		it('should handle peers message', () => {
			const stellarMessage = createDummyPeersMessage();
			const crawlState = mock<CrawlState>();
			const peerNodes = new PeerNodeCollection();
			peerNodes.getOrAdd(senderPublicKey);
			crawlState.peerNodes = peerNodes;
			const peerAddressesListener = jest.fn();
			handler.on('peerAddressesReceived', peerAddressesListener);

			const result = handler.handleStellarMessage(
				senderPublicKey,
				stellarMessage,
				crawlState
			);
			expect(peerAddressesListener).toHaveBeenCalledTimes(1);
			expect(result.isOk()).toBeTruthy();
			expect(peerNodes.get(senderPublicKey)?.suppliedPeerList).toBeTruthy();
		});

		it('should handle SCP quorum set message', () => {
			const stellarMessage = createDummyQuorumSetMessage();
			const crawlState = mock<CrawlState>();
			const result = handler.handleStellarMessage(
				senderPublicKey,
				stellarMessage,
				crawlState
			);
			expect(quorumSetManager.processQuorumSet).toHaveBeenCalledTimes(1);
			expect(result.isOk()).toBeTruthy();
		});

		it('should handle dont have message', () => {
			const stellarMessage = createDummyDontHaveMessage();
			const crawlState = mock<CrawlState>();
			handler.handleStellarMessage(senderPublicKey, stellarMessage, crawlState);
			expect(
				quorumSetManager.peerNodeDoesNotHaveQuorumSet
			).toHaveBeenCalledTimes(1);
		});

		it('should handle errLoad message', () => {
			const stellarMessage = createDummyErrLoadMessage();
			const crawlState = mock<CrawlState>();
			const peerNodes = new PeerNodeCollection();
			peerNodes.getOrAdd(senderPublicKey);
			crawlState.peerNodes = peerNodes;
			const result = handler.handleStellarMessage(
				senderPublicKey,
				stellarMessage,
				crawlState
			);
			expect(result.isOk()).toBeTruthy();
			expect(
				crawlState.peerNodes.get(senderPublicKey)?.overLoaded
			).toBeTruthy();
		});
	});
});
