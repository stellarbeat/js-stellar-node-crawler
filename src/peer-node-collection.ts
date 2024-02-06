import { PeerNode } from './peer-node';
import { NodeInfo } from '@stellarbeat/js-stellar-node-connector/lib/node';

export class PeerNodeCollection {
	constructor(private peerNodes: Map<string, PeerNode> = new Map()) {}

	add(publicKey: string) {
		let peerNode = this.peerNodes.get(publicKey);
		if (peerNode) return peerNode;

		peerNode = new PeerNode(publicKey);
		this.peerNodes.set(publicKey, peerNode);

		return peerNode;
	}

	get(publicKey: string) {
		return this.peerNodes.get(publicKey);
	}

	addSuccessfullyConnected(
		publicKey: string,
		ip: string,
		port: number,
		nodeInfo: NodeInfo
	): PeerNode | Error {
		let peerNode = this.peerNodes.get(publicKey);
		if (peerNode && peerNode.successfullyConnected) {
			return new Error('PeerNode reusing publicKey');
		}

		if (!peerNode) {
			peerNode = new PeerNode(publicKey);
		}

		peerNode.nodeInfo = nodeInfo;
		peerNode.ip = ip;
		peerNode.port = port;

		this.peerNodes.set(publicKey, peerNode);

		return peerNode;
	}
}
