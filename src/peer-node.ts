import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { NodeInfo } from '@stellarbeat/js-stellar-node-connector/lib/node';
import { Ledger } from './crawler';

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
	public suppliedPeerList = false;
	public latestActiveSlotIndex?: string;
	public participatingInSCP = false;
	public observedLedgerCloses: number = 0;
	public disconnected: boolean = false;
	public externalizedValues: Map<
		bigint,
		{
			localTime: Date;
			value: string;
		}
	> = new Map();
	public lagInMS: number | undefined;

	constructor(publicKey: string) {
		this.publicKey = publicKey;
	}

	get key(): string {
		return this.ip + ':' + this.port;
	}

	get successfullyConnected(): boolean {
		return this.ip !== undefined;
	}

	hasExternalizedLedger(slotIndex: bigint): boolean {
		return this.externalizedValues.has(slotIndex);
	}

	externalizedLedgerValueIsCorrect(slotIndex: bigint, value: string): boolean {
		return this.externalizedValues.get(slotIndex)?.value === value;
	}

	updateLag(closedLedger: Ledger): void {
		if (this.hasExternalizedLedger(closedLedger.sequence)) {
			const lag = this.determineLag(
				closedLedger.localCloseTime,
				this.externalizedValues.get(closedLedger.sequence)!.localTime
			);

			if (!this.lagInMS || this.lagInMS > lag) {
				this.lagInMS = lag; //we report the smallest lag, to discard slower relayed externalize messages
			}
		}
	}

	/*determineValidatingStatusAndLag(closedLedger: Ledger): void {
		if (this.hasExternalizedLedger(closedLedger.sequence)) {
			this.isValidating = true;
			this.isValidatingIncorrectValues = !this.externalizedLedgerValueIsCorrect(
				closedLedger.sequence,
				closedLedger.value
			);
			const lag = this.determineLag(
				closedLedger.localCloseTime,
				this.externalizedValues.get(closedLedger.sequence)!.localTime
			);

			if (!this.lagInMS || this.lagInMS < lag) {
				this.lagInMS = lag; //we report the biggest lag
			}
		}
	}*/

	private determineLag(localLedgerCloseTime: Date, externalizeTime: Date) {
		return externalizeTime.getTime() - localLedgerCloseTime.getTime();
	}
}
