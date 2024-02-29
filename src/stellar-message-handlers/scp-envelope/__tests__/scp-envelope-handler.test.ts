import { mock } from 'jest-mock-extended';
import { ScpStatementHandler } from '../scp-statement/scp-statement-handler';
import { ScpEnvelopeHandler } from '../scp-envelope-handler';
import { createDummyExternalizeScpEnvelope } from '../../../../fixtures/createDummyExternalizeMessage';
import { CrawlState } from '../../../crawl-state';
import LRUCache = require('lru-cache');
import { Keypair, Networks, xdr } from '@stellar/stellar-base';

describe('scp-envelope-handler', () => {
	it('should process valid scp envelope', () => {
		const scpStatementHandler = mock<ScpStatementHandler>();
		const handler = new ScpEnvelopeHandler(scpStatementHandler);
		const scpEnvelope = createDummyExternalizeScpEnvelope();
		const crawlState = mock<CrawlState>();
		crawlState.latestClosedLedger = {
			sequence: BigInt(1),
			closeTime: new Date(),
			value: '',
			localCloseTime: new Date()
		};
		crawlState.network = Networks.PUBLIC;
		crawlState.envelopeCache = new LRUCache<string, number>({ max: 1000 });
		handler.processScpEnvelope(scpEnvelope, crawlState);
		expect(scpStatementHandler.handle).toHaveBeenCalledTimes(1);
	});

	it('should not process duplicate scp envelope', () => {
		const scpStatementHandler = mock<ScpStatementHandler>();
		const handler = new ScpEnvelopeHandler(scpStatementHandler);
		const scpEnvelope = createDummyExternalizeScpEnvelope();
		const crawlState = mock<CrawlState>();
		crawlState.latestClosedLedger = {
			sequence: BigInt(1),
			closeTime: new Date(),
			value: '',
			localCloseTime: new Date()
		};
		crawlState.network = Networks.PUBLIC;
		crawlState.envelopeCache = new LRUCache<string, number>({ max: 1000 });
		handler.processScpEnvelope(scpEnvelope, crawlState);
		handler.processScpEnvelope(scpEnvelope, crawlState);
		expect(scpStatementHandler.handle).toHaveBeenCalledTimes(1);
	});

	it('should not process scp envelope with invalid (too old) ledger', () => {
		const scpStatementHandler = mock<ScpStatementHandler>();
		const handler = new ScpEnvelopeHandler(scpStatementHandler);
		const scpEnvelope = createDummyExternalizeScpEnvelope();
		const crawlState = mock<CrawlState>();
		crawlState.latestClosedLedger = {
			sequence: BigInt(100),
			closeTime: new Date(),
			value: '',
			localCloseTime: new Date()
		};
		crawlState.network = Networks.PUBLIC;
		crawlState.envelopeCache = new LRUCache<string, number>({ max: 1000 });
		handler.processScpEnvelope(scpEnvelope, crawlState);
		expect(scpStatementHandler.handle).toHaveBeenCalledTimes(0);
	});

	it('should not process scp envelope with invalid signature', () => {
		const scpStatementHandler = mock<ScpStatementHandler>();
		const handler = new ScpEnvelopeHandler(scpStatementHandler);
		const scpEnvelope = createDummyExternalizeScpEnvelope(
			Keypair.random(),
			Buffer.from('wrong network')
		);
		const crawlState = mock<CrawlState>();
		crawlState.latestClosedLedger = {
			sequence: BigInt(1),
			closeTime: new Date(),
			value: '',
			localCloseTime: new Date()
		};
		crawlState.network = Networks.PUBLIC;
		crawlState.envelopeCache = new LRUCache<string, number>({ max: 1000 });
		const result = handler.processScpEnvelope(scpEnvelope, crawlState);
		expect(scpStatementHandler.handle).toHaveBeenCalledTimes(0);
		expect(result.isErr()).toBeTruthy();
		if (!result.isErr()) throw new Error('Expected error but got ok');
		expect(result.error.message).toEqual('Invalid SCP Signature');
	});
});
