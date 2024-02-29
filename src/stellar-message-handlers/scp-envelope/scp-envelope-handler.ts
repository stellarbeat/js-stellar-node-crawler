import { hash, xdr } from '@stellar/stellar-base';
import { CrawlState } from '../../crawl-state';
import { verifySCPEnvelopeSignature } from '@stellarbeat/js-stellar-node-connector';
import { err, ok, Result } from 'neverthrow';
import { isLedgerSequenceValid } from './ledger-validator';
import { ScpStatementHandler } from './scp-statement/scp-statement-handler';

/*
 * ScpEnvelopeHandler makes sure that no duplicate SCP envelopes are processed, that the signature is valid and
 * that the ledger sequence is valid. It then delegates the SCP statement to the ScpStatementHandler.
 */
export class ScpEnvelopeHandler {
	constructor(private scpStatementHandler: ScpStatementHandler) {}

	public processScpEnvelope(
		scpEnvelope: xdr.ScpEnvelope,
		crawlState: CrawlState
	): Result<void, Error> {
		if (this.isCached(scpEnvelope, crawlState)) return ok(undefined);

		if (this.isValidLedger(crawlState, scpEnvelope)) return ok(undefined);

		const verifiedSignature = this.verifySignature(scpEnvelope, crawlState);
		if (verifiedSignature.isErr()) return verifiedSignature;

		return this.scpStatementHandler.handle(scpEnvelope.statement(), crawlState);
	}

	private verifySignature(
		scpEnvelope: xdr.ScpEnvelope,
		crawlState: CrawlState
	): Result<void, Error> {
		const verifiedResult = verifySCPEnvelopeSignature(
			scpEnvelope,
			hash(Buffer.from(crawlState.network))
		);
		if (verifiedResult.isErr())
			return err(new Error('Error verifying SCP Signature'));

		if (!verifiedResult.value) return err(new Error('Invalid SCP Signature'));

		return ok(undefined);
	}

	private isValidLedger(crawlState: CrawlState, scpEnvelope: xdr.ScpEnvelope) {
		return !isLedgerSequenceValid(
			crawlState.latestClosedLedger,
			BigInt(scpEnvelope.statement().slotIndex().toString())
		);
	}

	private isCached(
		scpEnvelope: xdr.ScpEnvelope,
		crawlState: CrawlState
	): boolean {
		if (crawlState.envelopeCache.has(scpEnvelope.signature().toString()))
			return true;
		crawlState.envelopeCache.set(scpEnvelope.signature().toString(), 1);
		return false;
	}
}
