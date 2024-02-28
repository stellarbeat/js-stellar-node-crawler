import { hash, Keypair, Networks, xdr } from '@stellar/stellar-base';
import { createSCPEnvelopeSignature } from '@stellarbeat/js-stellar-node-connector';

export function createDummyValue() {
	return Buffer.from(
		'    Bdej9XkMRNa5mYeecoR8W1+E10N8cje2irYfmzNh/eIAAAAAZd2fCAAAAAAAAAABAAAAAIwdS0o2ARfVAN/PjN6xZrGaEuD0t7zToaDF6Z5B9peZAAAAQIRy/bWclKwWkxF4qTOg0pBncXfpJhczLQP5D60JlqhgR5Vzcn1KOHTSavxBS8+mZCaXNIe4iJFFfGPnxmRgBQI=',
		'base64'
	);
}

export function createDummyExternalizeMessage(
	keyPair: Keypair = Keypair.random(),
	networkHash = hash(Buffer.from(Networks.PUBLIC))
) {
	const commit = new xdr.ScpBallot({
		counter: 1,
		value: createDummyValue()
	});
	const externalize = new xdr.ScpStatementExternalize({
		commit: commit,
		nH: 1,
		commitQuorumSetHash: Buffer.alloc(32)
	});
	const pledges = xdr.ScpStatementPledges.scpStExternalize(externalize);

	const statement = new xdr.ScpStatement({
		nodeId: xdr.PublicKey.publicKeyTypeEd25519(keyPair.rawPublicKey()),
		slotIndex: xdr.Uint64.fromString('1'),
		pledges: pledges
	});

	const signatureResult = createSCPEnvelopeSignature(
		statement,
		keyPair.rawPublicKey(),
		keyPair.rawSecretKey(),
		networkHash
	);

	if (signatureResult.isErr()) {
		throw signatureResult.error;
	}

	const envelope = new xdr.ScpEnvelope({
		statement: statement,
		signature: signatureResult.value
	});

	return xdr.StellarMessage.scpMessage(envelope);
}
