import { mock } from 'jest-mock-extended';
import { ScpStatementHandler } from '../scp-statement-handler';
import { QuorumSetManager } from '../../../../../quorum-set-manager';
import { P } from 'pino';
import { ExternalizeStatementHandler } from '../externalize/externalize-statement-handler';
import {
	createDummyExternalizeStatement,
	createDummyNominationMessage
} from '../../../../../../__fixtures__/createDummyExternalizeMessage';
import { Keypair } from '@stellar/stellar-base';
import { PeerNodeCollection } from '../../../../../../peer-node-collection';
import { Slots } from '../externalize/slots';
import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { Ledger } from '../../../../../../crawler';
import { Observation } from '../../../../../observation';

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
		const observation = mock<Observation>();
		observation.peerNodes = new PeerNodeCollection();
		observation.slots = new Slots(
			new QuorumSet(1, ['A'], []),
			mock<P.Logger>()
		);
		observation.latestConfirmedClosedLedger = {
			sequence: BigInt(1),
			closeTime: new Date(),
			value: '',
			localCloseTime: new Date()
		};

		const result = handler.handle(scpStatement, observation);
		expect(result.isOk()).toBeTruthy();
		if (!result.isOk()) return;
		expect(result.value.closedLedger).toEqual(closedLedger);
		expect(
			observation.peerNodes.get(keyPair.publicKey())?.participatingInSCP
		).toBeTruthy();
		expect(
			observation.peerNodes.get(keyPair.publicKey())?.latestActiveSlotIndex
		).toEqual('1');
		expect(
			quorumSetManager.processQuorumSetHashFromStatement
		).toHaveBeenCalledTimes(1);
	});

	it('should not return already closed ledger or older ledger', () => {
		const quorumSetManager = mock<QuorumSetManager>();
		const externalizeStatementHandler = mock<ExternalizeStatementHandler>();
		const handler = new ScpStatementHandler(
			quorumSetManager,
			externalizeStatementHandler,
			mock<P.Logger>()
		);

		const keyPair = Keypair.random();
		const scpStatement = createDummyExternalizeStatement(keyPair, '2');
		const observation = mock<Observation>();
		observation.peerNodes = new PeerNodeCollection();
		observation.slots = new Slots(
			new QuorumSet(1, ['A'], []),
			mock<P.Logger>()
		);
		observation.latestConfirmedClosedLedger = {
			sequence: BigInt(2),
			closeTime: new Date(),
			value: '',
			localCloseTime: new Date()
		};
		externalizeStatementHandler.handle.mockReturnValueOnce(
			observation.latestConfirmedClosedLedger
		);

		const result = handler.handle(scpStatement, observation);
		expect(result.isOk()).toBeTruthy();
		if (!result.isOk()) return;
		expect(result.value.closedLedger).toBeNull();
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

		const observation = mock<Observation>();
		observation.peerNodes = new PeerNodeCollection();

		const result = handler.handle(
			nominationMessage.envelope().statement(),
			observation
		);
		expect(result.isOk()).toBeTruthy();
		if (!result.isOk()) return;
		expect(result.value.closedLedger).toBeNull();
		expect(
			observation.peerNodes.get(keyPair.publicKey())?.participatingInSCP
		).toBeTruthy();
		expect(
			observation.peerNodes.get(keyPair.publicKey())?.latestActiveSlotIndex
		).toEqual('1');
		expect(
			quorumSetManager.processQuorumSetHashFromStatement
		).toHaveBeenCalledTimes(1);
		expect(externalizeStatementHandler.handle).toHaveBeenCalledTimes(0);
	});
});
