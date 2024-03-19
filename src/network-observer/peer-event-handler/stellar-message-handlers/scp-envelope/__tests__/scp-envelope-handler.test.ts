import { mock } from 'jest-mock-extended';
import { ScpStatementHandler } from '../scp-statement/scp-statement-handler';
import { ScpEnvelopeHandler } from '../scp-envelope-handler';
import { createDummyExternalizeScpEnvelope } from '../../../../../__fixtures__/createDummyExternalizeMessage';
import LRUCache = require('lru-cache');
import { Keypair, Networks } from '@stellar/stellar-base';
import { ok } from 'neverthrow';
import { Observation } from '../../../../observation';

describe('scp-envelope-handler', () => {
	it('should process valid scp envelope and return closed ledger', () => {
		const scpStatementHandler = mock<ScpStatementHandler>();
		const closedLedger = {
			sequence: BigInt(2),
			closeTime: new Date(),
			value: '',
			localCloseTime: new Date()
		};
		scpStatementHandler.handle.mockReturnValueOnce(ok({ closedLedger }));
		const handler = new ScpEnvelopeHandler(scpStatementHandler);
		const scpEnvelope = createDummyExternalizeScpEnvelope();
		const crawlState = createMockObservation();
		const result = handler.handle(scpEnvelope, crawlState);
		expect(scpStatementHandler.handle).toHaveBeenCalledTimes(1);
		expect(result.isOk()).toBeTruthy();
		if (!result.isOk()) return;
		expect(result.value.closedLedger).toEqual(closedLedger);
	});

	it('should not process duplicate scp envelope', () => {
		const scpStatementHandler = mock<ScpStatementHandler>();
		const handler = new ScpEnvelopeHandler(scpStatementHandler);
		const scpEnvelope = createDummyExternalizeScpEnvelope();
		const crawlState = createMockObservation();
		handler.handle(scpEnvelope, crawlState);
		handler.handle(scpEnvelope, crawlState);
		expect(scpStatementHandler.handle).toHaveBeenCalledTimes(1);
	});

	it('should not process scp envelope with invalid (too old) ledger', () => {
		const scpStatementHandler = mock<ScpStatementHandler>();
		const handler = new ScpEnvelopeHandler(scpStatementHandler);
		const scpEnvelope = createDummyExternalizeScpEnvelope();
		const crawlState = createMockObservation(BigInt(100));
		handler.handle(scpEnvelope, crawlState);
		expect(scpStatementHandler.handle).toHaveBeenCalledTimes(0);
	});

	it('should not process scp envelope with invalid signature', () => {
		const scpStatementHandler = mock<ScpStatementHandler>();
		const handler = new ScpEnvelopeHandler(scpStatementHandler);
		const scpEnvelope = createDummyExternalizeScpEnvelope(
			Keypair.random(),
			Buffer.from('wrong network')
		);
		const crawlState = createMockObservation();
		const result = handler.handle(scpEnvelope, crawlState);
		expect(scpStatementHandler.handle).toHaveBeenCalledTimes(0);
		expect(result.isErr()).toBeTruthy();
		if (!result.isErr()) throw new Error('Expected error but got ok');
		expect(result.error.message).toEqual('Invalid SCP Signature');
	});

	function createMockObservation(sequence = BigInt(1)) {
		const observation = mock<Observation>();
		observation.latestConfirmedClosedLedger = {
			sequence: sequence,
			closeTime: new Date(),
			value: '',
			localCloseTime: new Date()
		};
		observation.network = Networks.PUBLIC;
		observation.envelopeCache = new LRUCache<string, number>({ max: 1000 });
		return observation;
	}

	it('should not process scp envelope when processing SCP signature fails', () => {
		const scpStatementHandler = mock<ScpStatementHandler>();
		const handler = new ScpEnvelopeHandler(scpStatementHandler);
		const scpEnvelope = createDummyExternalizeScpEnvelope();
		scpEnvelope.signature(Buffer.alloc(20)); // invalid signature
		const crawlState = createMockObservation();
		const result = handler.handle(scpEnvelope, crawlState);
		expect(scpStatementHandler.handle).toHaveBeenCalledTimes(0);
		expect(result.isErr()).toBeTruthy();
		if (!result.isErr()) throw new Error('Expected error but got ok');
		expect(result.error.message).toEqual('Error verifying SCP Signature');
	});
});
