import { xdr } from '@stellar/stellar-base';

export function createDummyErrLoadMessage() {
	return xdr.StellarMessage.errorMsg(
		new xdr.Error({
			code: xdr.ErrorCode.errLoad(),
			msg: 'Error loading'
		})
	);
}
