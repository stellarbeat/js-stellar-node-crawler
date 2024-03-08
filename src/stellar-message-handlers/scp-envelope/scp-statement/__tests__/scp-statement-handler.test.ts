import { mock } from 'jest-mock-extended';
import { ScpStatementHandler } from '../scp-statement-handler';
import { QuorumSetManager } from '../../../../quorum-set-manager';
import { P } from 'pino';
import { ExternalizeStatementHandler } from '../externalize/externalize-statement-handler';
import {
	createDummyExternalizeStatement,
	createDummyNominationMessage
} from '../../../../__fixtures__/createDummyExternalizeMessage';
import { Keypair } from '@stellar/stellar-base';
import { CrawlState } from '../../../../crawl-state';
import { PeerNodeCollection } from '../../../../peer-node-collection';
import { Slots } from '../externalize/slots';
import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { Ledger } from '../../../../crawler';

describe('scp-statement-handler', () => {
	it('should process new scp statement and newly closed ledger', () => {
		const quorumSetManager = mock<QuorumSetManager>();
		const externalizeStatementHandler = mock<ExternalizeStatementHandler>();
		const closedLedger: Ledger = {
			sequence: BigInt(2),
			closeTime: new Date(),
			value: '',
			localCloseTime: new Date()
		};
		externalizeStatementHandler.handle.mockReturnValueOnce(closedLedger);
		const handler = new ScpStatementHandler(
			quorumSetManager,
			externalizeStatementHandler,
			mock<P.Logger>()
		);

		const keyPair = Keypair.random();
		const scpStatement = createDummyExternalizeStatement(keyPair);
		const crawlState = mock<CrawlState>();
		crawlState.peerNodes = new PeerNodeCollection();
		crawlState.slots = new Slots(new QuorumSet(1, ['A'], []), mock<P.Logger>());
		crawlState.latestConfirmedClosedLedger = {
			sequence: BigInt(1),
			closeTime: new Date(),
			value: '',
			localCloseTime: new Date()
		};

		const result = handler.handle(scpStatement, crawlState);
		expect(result.isOk()).toBeTruthy();
		expect(
			crawlState.peerNodes.get(keyPair.publicKey())?.participatingInSCP
		).toBeTruthy();
		expect(
			crawlState.peerNodes.get(keyPair.publicKey())?.latestActiveSlotIndex
		).toEqual('1');
		expect(
			quorumSetManager.processQuorumSetHashFromStatement
		).toHaveBeenCalledTimes(1);
		expect(crawlState.latestConfirmedClosedLedger).toEqual(closedLedger);
	});

	it('should not use non-externalize statement for ledger close confirmation', () => {
		const keyPair = Keypair.random();
		const nominationMessage = createDummyNominationMessage(keyPair);

		const quorumSetManager = mock<QuorumSetManager>();
		const externalizeStatementHandler = mock<ExternalizeStatementHandler>();

		const handler = new ScpStatementHandler(
			quorumSetManager,
			externalizeStatementHandler,
			mock<P.Logger>()
		);

		const crawlState = mock<CrawlState>();
		crawlState.peerNodes = new PeerNodeCollection();

		const result = handler.handle(
			nominationMessage.envelope().statement(),
			crawlState
		);
		expect(result.isOk()).toBeTruthy();
		expect(
			crawlState.peerNodes.get(keyPair.publicKey())?.participatingInSCP
		).toBeTruthy();
		expect(
			crawlState.peerNodes.get(keyPair.publicKey())?.latestActiveSlotIndex
		).toEqual('1');
		expect(
			quorumSetManager.processQuorumSetHashFromStatement
		).toHaveBeenCalledTimes(1);
		expect(externalizeStatementHandler.handle).toHaveBeenCalledTimes(0);
	});
});
