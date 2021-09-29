import { QuorumSet } from '@stellarbeat/js-stellar-domain';
import { NodeInfo } from '@stellarbeat/js-stellar-node-connector/lib/node';

export class PeerNode {
	public ip?: string;
	public port?: number;
	public publicKey: string;
	public nodeInfo?: NodeInfo;
	public isValidating = false;
	public isValidatingIncorrectValues = false;
	public overLoaded = false;
	public quorumSetHash: string | undefined;
	public quorumSet: QuorumSet | undefined;
	public suppliedPeerList: boolean = false;
	public latestActiveSlotIndex?: string;

	constructor(publicKey: string) {
		this.publicKey = publicKey;
	}

	get key() {
		return this.ip + ':' + this.port;
	}

	get participatingInSCP() {
		return this.latestActiveSlotIndex !== undefined;
	}

	get successfullyConnected() {
		return this.ip !== undefined;
	}
}
