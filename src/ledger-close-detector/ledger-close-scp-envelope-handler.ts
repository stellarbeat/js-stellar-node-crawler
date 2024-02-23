import * as P from 'pino';
import { hash, Networks, xdr } from '@stellar/stellar-base';
import {
	getPublicKeyStringFromBuffer,
	verifySCPEnvelopeSignature
} from '@stellarbeat/js-stellar-node-connector';
import { err, ok, Result } from 'neverthrow';
import { Ledger } from '../crawler';
import { PublicKey } from '@stellarbeat/js-stellarbeat-shared';
import { SlotCloser } from './slot-closer';
import { mapExternalizeStatement } from './map-externalize-statement';

export class LedgerCloseScpEnvelopeHandler {
	constructor(private slotCloser: SlotCloser, private logger: P.Logger) {}

	public handleScpEnvelope(
		scpEnvelope: xdr.ScpEnvelope,
		networkHash: Buffer
	): Result<undefined | Ledger, Error> {
		if (!this.containsExternalizeStatement(scpEnvelope)) return ok(undefined);

		const verifiedResult = verifySCPEnvelopeSignature(scpEnvelope, networkHash);
		if (verifiedResult.isErr())
			return err(new Error('Error verifying SCP Signature'));
		if (verifiedResult.value === false)
			return err(new Error('Invalid SCP Signature'));

		const mapResult = mapExternalizeStatement(scpEnvelope.statement());
		if (mapResult.isErr()) return err(mapResult.error);

		return this.attemptSlotClose(
			mapResult.value.publicKey,
			mapResult.value.slotIndex,
			mapResult.value.value
		);
	}

	private containsExternalizeStatement(scpEnvelope: xdr.ScpEnvelope) {
		return (
			scpEnvelope.statement().pledges().switch().value ===
			xdr.ScpStatementType.scpStExternalize().value
		);
	}

	private attemptSlotClose(
		publicKey: PublicKey,
		slotIndex: bigint,
		value: string
	): Result<undefined | Ledger, Error> {
		this.logger.debug(
			{ ledger: slotIndex.toString(), publicKey: publicKey, value: value },
			'Attempting to close ledger'
		);
		const newClosedSlotOrUndefined = this.slotCloser.attemptSlotClose(
			publicKey,
			slotIndex,
			value
		);

		if (newClosedSlotOrUndefined === undefined) return ok(undefined);

		return ok({
			sequence: slotIndex,
			closeTime: newClosedSlotOrUndefined.closeTime
		});
	}
}
