import { xdr } from '@stellar/stellar-base';
import { err, ok, Result } from 'neverthrow';
import { getPublicKeyStringFromBuffer } from '@stellarbeat/js-stellar-node-connector';
import { extractCloseTimeFromValue } from './ledger-close-detector/extract-close-time-from-value';

export interface ExternalizeData {
	publicKey: string;
	slotIndex: bigint;
	value: string;
	closeTime: Date;
}

export function mapExternalizeStatement(
	externalizeStatement: xdr.ScpStatement
): Result<ExternalizeData, Error> {
	const publicKeyResult = getPublicKeyStringFromBuffer(
		externalizeStatement.nodeId().value()
	);
	if (publicKeyResult.isErr()) {
		return err(publicKeyResult.error);
	}

	const publicKey = publicKeyResult.value;
	const slotIndex = BigInt(externalizeStatement.slotIndex().toString());

	const value = externalizeStatement.pledges().externalize().commit().value();

	const closeTime = extractCloseTimeFromValue(value);

	return ok({
		publicKey,
		slotIndex,
		value: value.toString('base64'),
		closeTime
	});
}
