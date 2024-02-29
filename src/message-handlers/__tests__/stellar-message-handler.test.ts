import { StellarMessageHandler } from '../stellar-message-handler';
import { ScpEnvelopeHandler } from '../scp-envelope-handler';
import { QuorumSetManager } from '../../quorum-set-manager';
import { P } from 'pino';
import { CrawlState } from '../../crawl-state';
import { Keypair } from '@stellar/stellar-base';
import { mock, MockProxy } from 'jest-mock-extended';
import { createDummyExternalizeMessage } from '../../../fixtures/createDummyExternalizeMessage';
import { ok } from 'neverthrow';
import { createDummyPeersMessage } from '../../../fixtures/createDummyPeersMessage';
import { createDummyQuorumSetMessage } from '../../../fixtures/createDummyQuorumSetMessage';
import { createDummyDontHaveMessage } from '../../../fixtures/createDummyDontHaveMessage';
import { createDummyErrLoadMessage } from '../../../fixtures/createDummyErrLoadMessage';
import { PeerNode } from '../../index';
import { PeerNodeCollection } from '../../peer-node-collection';

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
		it('should handle SCP message', () => {
			const keyPair = Keypair.random();
			const stellarMessage = createDummyExternalizeMessage(keyPair);
			const crawlState = mock<CrawlState>();
			scpManager.processScpEnvelope.mockReturnValueOnce(ok(undefined));
			const result = handler.handleStellarMessage(
				senderPublicKey,
				stellarMessage,
				crawlState
			);
			expect(scpManager.processScpEnvelope).toHaveBeenCalledTimes(1);
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
