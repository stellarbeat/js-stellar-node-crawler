import { Keypair, xdr } from '@stellar/stellar-base';

export function createDummyQuorumSetMessage(): xdr.StellarMessage {
	const keypair1 = Keypair.random();
	const keypair2 = Keypair.random();
	const qSet = new xdr.ScpQuorumSet({
		threshold: 1,
		validators: [
			xdr.PublicKey.publicKeyTypeEd25519(keypair1.rawPublicKey()),
			xdr.PublicKey.publicKeyTypeEd25519(keypair2.rawPublicKey())
		],
		innerSets: []
	});

	return xdr.StellarMessage.scpQuorumset(qSet);
}
