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
	public connectionTime?: Date;
	public disconnectionTime?: Date;
	public connectedDuringLedgerClose = false;
	public disconnected: boolean = false;
	private externalizedValues: Map<
		bigint,
		{
			localTime: Date;
			value: string;
		}
	> = new Map();
	private lagMSMeasurement: Map<bigint, number> = new Map();

	constructor(publicKey: string) {
		this.publicKey = publicKey;
	}

	get key(): string {
		return this.ip + ':' + this.port;
	}

	get successfullyConnected(): boolean {
		return this.connectionTime !== undefined;
	}

	processConfirmedLedgerClose(closedLedger: Ledger) {
		const externalized = this.externalizedValues.get(closedLedger.sequence);

		if (!externalized) {
			return;
		}

		if (externalized.value !== closedLedger.value) {
			this.isValidatingIncorrectValues = true;
			return;
		}

		this.isValidating = true;

		if (
			this.connectedBeforeLocalLedgerClose(closedLedger) &&
			!this.disconnectedBeforeLocalLedgerClose(closedLedger) &&
			!this.externalizedAfterDisconnect(externalized) &&
			!this.overLoaded
		) {
			this.connectedDuringLedgerClose = true;
		}

		this.updateLag(closedLedger, externalized);
	}

	private externalizedAfterDisconnect(externalized: {
		localTime: Date;
		value: string;
	}) {
		if (!this.disconnectionTime) return false;
		return externalized.localTime.getTime() > this.disconnectionTime.getTime();
	}

	private disconnectedBeforeLocalLedgerClose(closedLedger: Ledger) {
		if (!this.disconnectionTime) {
			return false;
		}

		return (
			closedLedger.localCloseTime.getTime() >= this.disconnectionTime.getTime()
		);
	}

	private connectedBeforeLocalLedgerClose(closedLedger: Ledger) {
		return (
			this.connectionTime &&
			this.connectionTime.getTime() <= closedLedger.localCloseTime.getTime()
		);
	}

	public addExternalizedValue(
		slotIndex: bigint,
		localTime: Date,
		value: string
	): void {
		this.externalizedValues.set(slotIndex, {
			localTime: localTime,
			value: value
		});
	}

	private updateLag(
		closedLedger: Ledger,
		externalized: {
			localTime: Date;
			value: string;
		}
	): void {
		this.lagMSMeasurement.set(
			closedLedger.sequence,
			this.determineLag(closedLedger.localCloseTime, externalized.localTime)
		);
	}

	private determineLag(localLedgerCloseTime: Date, externalizeTime: Date) {
		return externalizeTime.getTime() - localLedgerCloseTime.getTime();
	}

	public getMinLagMS(): number | undefined {
		//implement without using spread operator
		let minLag: number | undefined;
		for (const lag of this.lagMSMeasurement.values()) {
			if (minLag === undefined || lag < minLag) {
				minLag = lag;
			}
		}

		return minLag;
	}
}
