import { hash, Keypair, Networks, xdr } from '@stellar/stellar-base';
import { createSCPEnvelopeSignature } from '@stellarbeat/js-stellar-node-connector';

export function createDummyValue() {
	return Buffer.from(
		'    Bdej9XkMRNa5mYeecoR8W1+E10N8cje2irYfmzNh/eIAAAAAZd2fCAAAAAAAAAABAAAAAIwdS0o2ARfVAN/PjN6xZrGaEuD0t7zToaDF6Z5B9peZAAAAQIRy/bWclKwWkxF4qTOg0pBncXfpJhczLQP5D60JlqhgR5Vzcn1KOHTSavxBS8+mZCaXNIe4iJFFfGPnxmRgBQI=',
		'base64'
	);
}

export function createDummyExternalizeStatement(
	keyPair: Keypair = Keypair.random()
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

	return new xdr.ScpStatement({
		nodeId: xdr.PublicKey.publicKeyTypeEd25519(keyPair.rawPublicKey()),
		slotIndex: xdr.Uint64.fromString('1'),
		pledges: pledges
	});
}

export function createDummyExternalizeScpEnvelope(
	keyPair: Keypair = Keypair.random(),
	networkHash = hash(Buffer.from(Networks.PUBLIC))
) {
	const statement = createDummyExternalizeStatement(keyPair);
	const signatureResult = createSCPEnvelopeSignature(
		statement,
		keyPair.rawPublicKey(),
		keyPair.rawSecretKey(),
		networkHash
	);

	if (signatureResult.isErr()) {
		throw signatureResult.error;
	}

	return new xdr.ScpEnvelope({
		statement: statement,
		signature: signatureResult.value
	});
}

export function createDummyExternalizeMessage(
	keyPair: Keypair = Keypair.random(),
	networkHash = hash(Buffer.from(Networks.PUBLIC))
) {
	return xdr.StellarMessage.scpMessage(
		createDummyExternalizeScpEnvelope(keyPair, networkHash)
	);
}

export function createDummyNominationMessage(
	keyPair: Keypair = Keypair.random(),
	networkHash = hash(Buffer.from(Networks.PUBLIC))
) {
	const statement = createDummyNominateStatement(keyPair);
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

export function createDummyNominateStatement(
	keyPair: Keypair = Keypair.random()
) {
	const nomination = new xdr.ScpNomination({
		quorumSetHash: Buffer.alloc(32),
		votes: [Buffer.alloc(32), Buffer.alloc(32)],
		accepted: [Buffer.alloc(32), Buffer.alloc(32)]
	});
	const pledges = xdr.ScpStatementPledges.scpStNominate(nomination);

	return new xdr.ScpStatement({
		nodeId: xdr.PublicKey.publicKeyTypeEd25519(keyPair.rawPublicKey()),
		slotIndex: xdr.Uint64.fromString('1'),
		pledges: pledges
	});
}
