import { xdr } from '@stellar/stellar-base';

export function createDummyPeersMessage(): xdr.StellarMessage {
	const peerAddress = new xdr.PeerAddress({
		ip: xdr.PeerAddressIp.iPv4(Buffer.from([127, 0, 0, 1])),
		port: 11625,
		numFailures: 0
	});

	return xdr.StellarMessage.peers([peerAddress]);
}
