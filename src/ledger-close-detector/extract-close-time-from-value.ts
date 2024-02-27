import { xdr } from '@stellar/stellar-base';

export function extractCloseTimeFromValue(value: Buffer) {
	try {
		return new Date(
			1000 *
				Number(
					xdr.StellarValue.fromXDR(value).closeTime().toXDR().readBigUInt64BE()
				)
		);
	} catch (error) {
		return new Date();
	}
}
