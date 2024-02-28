import { PeerNode } from './peer-node';
import { NodeInfo } from '@stellarbeat/js-stellar-node-connector/lib/node';
import { Ledger } from './crawler';

type PublicKey = string;

export class PeerNodeCollection {
	constructor(private peerNodes: Map<string, PeerNode> = new Map()) {}

	addExternalizedValueForPeerNode(
		publicKey: string,
		slotIndex: bigint,
		value: string,
		localTime: Date
	): void {
		const peerNode = this.getOrAdd(publicKey);
		peerNode.externalizedValues.set(slotIndex, { localTime, value });
	}

	getOrAdd(publicKey: string) {
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

	getAll() {
		return this.peerNodes;
	}

	values() {
		return this.peerNodes.values();
	}

	get size() {
		return this.peerNodes.size;
	}

	setPeerOverloaded(publicKey: PublicKey, overloaded: boolean): void {
		const peer = this.peerNodes.get(publicKey);
		if (peer) {
			peer.overLoaded = overloaded;
		}
	}

	setPeerSuppliedPeerList(
		publicKey: PublicKey,
		suppliedPeerList: boolean
	): void {
		const peer = this.peerNodes.get(publicKey);
		if (peer) {
			peer.suppliedPeerList = suppliedPeerList;
		}
	}

	confirmLedgerClose(publicKey: PublicKey, closedLedger: Ledger): void {
		const peer = this.getOrAdd(publicKey);
		peer.processConfirmedLedgerClose(closedLedger);
	}

	//convenience method to avoid having to loop through all peers
	confirmLedgerCloseForDisagreeingNodes(
		disagreeingNodes: Set<PublicKey>
	): void {
		for (const publicKey of disagreeingNodes) {
			const peer = this.peerNodes.get(publicKey);
			if (peer) {
				peer.isValidatingIncorrectValues = true;
			}
		}
	}

	//convenience method to avoid having to loop through all peers
	confirmLedgerCloseForValidatingNodes(
		validatingNodes: Set<PublicKey>,
		ledger: Ledger
	): void {
		for (const publicKey of validatingNodes) {
			const peer = this.peerNodes.get(publicKey);
			if (peer) {
				peer.processConfirmedLedgerClose(ledger);
			}
		}
	}
}
