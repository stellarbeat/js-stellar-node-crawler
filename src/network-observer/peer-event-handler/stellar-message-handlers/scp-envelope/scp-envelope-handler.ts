import { hash, xdr } from '@stellar/stellar-base';
import { verifySCPEnvelopeSignature } from '@stellarbeat/js-stellar-node-connector';
import { err, ok, Result } from 'neverthrow';
import { isLedgerSequenceValid } from './ledger-validator';
import { ScpStatementHandler } from './scp-statement/scp-statement-handler';
import { Ledger } from '../../../../crawler';
import { Observation } from '../../../observation';

/*
 * ScpEnvelopeHandler makes sure that no duplicate SCP envelopes are processed, that the signature is valid and
 * that the ledger sequence is valid. It then delegates the SCP statement to the ScpStatementHandler.
 */
export class ScpEnvelopeHandler {
	constructor(private scpStatementHandler: ScpStatementHandler) {}

	public handle(
		scpEnvelope: xdr.ScpEnvelope,
		observation: Observation
	): Result<
		{
			closedLedger: Ledger | null;
		},
		Error
	> {
		if (this.isCached(scpEnvelope, observation))
			return ok({
				closedLedger: null
			});

		if (this.isValidLedger(observation, scpEnvelope))
			return ok({
				closedLedger: null
			});

		const verifiedSignature = this.verifySignature(scpEnvelope, observation);
		if (verifiedSignature.isErr()) return err(verifiedSignature.error);

		return this.scpStatementHandler.handle(
			scpEnvelope.statement(),
			observation
		);
	}

	private verifySignature(
		scpEnvelope: xdr.ScpEnvelope,
		observation: Observation
	): Result<void, Error> {
		const verifiedResult = verifySCPEnvelopeSignature(
			scpEnvelope,
			hash(Buffer.from(observation.network))
		);
		if (verifiedResult.isErr())
			return err(new Error('Error verifying SCP Signature'));

		if (!verifiedResult.value) return err(new Error('Invalid SCP Signature'));

		return ok(undefined);
	}

	private isValidLedger(
		observation: Observation,
		scpEnvelope: xdr.ScpEnvelope
	) {
		return !isLedgerSequenceValid(
			observation.latestConfirmedClosedLedger,
			BigInt(scpEnvelope.statement().slotIndex().toString())
		);
	}

	private isCached(
		scpEnvelope: xdr.ScpEnvelope,
		observation: Observation
	): boolean {
		if (observation.envelopeCache.has(scpEnvelope.signature().toString()))
			return true;
		observation.envelopeCache.set(scpEnvelope.signature().toString(), 1);
		return false;
	}
}
