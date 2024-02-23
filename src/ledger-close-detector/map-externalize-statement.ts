import { xdr } from '@stellar/stellar-base';
import { err, ok, Result } from 'neverthrow';
import { getPublicKeyStringFromBuffer } from '@stellarbeat/js-stellar-node-connector';

export function mapExternalizeStatement(
	externalizeStatement: xdr.ScpStatement
): Result<
	{
		publicKey: string;
		slotIndex: bigint;
		value: string;
	},
	Error
> {
	const publicKeyResult = getPublicKeyStringFromBuffer(
		externalizeStatement.nodeId().value()
	);
	if (publicKeyResult.isErr()) {
		return err(publicKeyResult.error);
	}

	const publicKey = publicKeyResult.value;
	const slotIndex = BigInt(externalizeStatement.slotIndex().toString());

	const value = externalizeStatement
		.pledges()
		.externalize()
		.commit()
		.value()
		.toString('base64');

	return ok({ publicKey, slotIndex, value });
}
