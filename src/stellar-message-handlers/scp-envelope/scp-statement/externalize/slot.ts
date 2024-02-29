import { Ledger } from '../../../../crawler';
import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import * as P from 'pino';
import containsSlice from '@stellarbeat/js-stellarbeat-shared/lib/quorum/containsSlice';
import { extractCloseTimeFromValue } from './extract-close-time-from-value';

export type SlotIndex = bigint;
type NodeId = string;
type SlotValue = string;

export class Slot {
	public index: SlotIndex;
	private confirmedClosedLedger?: Ledger;
	protected valuesMap: Map<SlotValue, Set<NodeId>> = new Map();
	protected localCloseTimeMap: Map<SlotValue, Date> = new Map(); //we store the first time we observed a close time for a value
	//we can't wait until we validated the value, because slow nodes could influence this time.
	protected trustedQuorumSet: QuorumSet;
	protected closeTime?: Date;
	protected localCloseTime?: Date;

	constructor(
		index: SlotIndex,
		trustedQuorumSet: QuorumSet,
		private logger: P.Logger
	) {
		this.index = index;
		this.trustedQuorumSet = trustedQuorumSet;
	}

	getNodesAgreeingOnExternalizedValue(): Set<NodeId> {
		if (this.confirmedClosedLedger === undefined) return new Set();

		const nodes = this.valuesMap.get(this.confirmedClosedLedger.value);
		if (!nodes) return new Set();

		return nodes;
	}

	getNodesDisagreeingOnExternalizedValue(): Set<NodeId> {
		let nodes = new Set<NodeId>();
		if (this.confirmedClosedLedger === undefined) return nodes;

		Array.from(this.valuesMap.keys())
			.filter((value) => value !== this.confirmedClosedLedger?.value)
			.forEach((value) => {
				const otherNodes = this.valuesMap.get(value);
				if (otherNodes) nodes = new Set([...nodes, ...otherNodes]);
			});

		return nodes;
	}

	addExternalizeValue(
		nodeId: NodeId,
		value: SlotValue,
		localCloseTime: Date
	): void {
		let nodesThatExternalizedValue = this.valuesMap.get(value);
		if (!nodesThatExternalizedValue) {
			nodesThatExternalizedValue = new Set();
			this.valuesMap.set(value, nodesThatExternalizedValue);
		}

		if (this.localCloseTimeMap.get(value) === undefined) {
			this.localCloseTimeMap.set(value, localCloseTime); //the first observed close time
		}

		if (nodesThatExternalizedValue.has(nodeId))
			//already recorded, no need to check if closed
			return;

		nodesThatExternalizedValue.add(nodeId);

		if (this.confirmedClosed()) return;

		if (!QuorumSet.getAllValidators(this.trustedQuorumSet).includes(nodeId)) {
			return;
		}

		this.logger.debug('Node part of trusted quorumSet, attempting slot close', {
			node: nodeId
		});

		if (containsSlice(this.trustedQuorumSet, nodesThatExternalizedValue)) {
			//try to close slot
			this.confirmedClosedLedger = {
				sequence: this.index,
				value: value,
				closeTime: extractCloseTimeFromValue(Buffer.from(value, 'base64')),
				localCloseTime: this.localCloseTimeMap.get(value)!
			};
		}
	}

	getConfirmedClosedLedger(): Ledger | undefined {
		return this.confirmedClosedLedger;
	}

	confirmedClosed(): boolean {
		return this.getConfirmedClosedLedger() !== undefined;
	}
}
