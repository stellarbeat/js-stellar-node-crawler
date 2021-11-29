import containsSlice from '@stellarbeat/js-stellar-domain/lib/quorum/containsSlice';
import { QuorumSet } from '@stellarbeat/js-stellar-domain';
import * as P from 'pino';

type SlotIndex = bigint;
type NodeId = string;
type SlotValue = string;

export class Slot {
	public index: SlotIndex;
	public externalizedValue?: SlotValue;
	protected valuesMap: Map<SlotValue, Set<NodeId>> = new Map();
	protected trustedQuorumSet: QuorumSet;

	constructor(
		index: SlotIndex,
		trustedQuorumSet: QuorumSet,
		protected logger: P.Logger
	) {
		this.index = index;
		this.trustedQuorumSet = trustedQuorumSet;
	}

	getNodesAgreeingOnExternalizedValue(): Set<NodeId> {
		if (this.externalizedValue === undefined) return new Set();

		const nodes = this.valuesMap.get(this.externalizedValue);
		if (!nodes) return new Set();

		return nodes;
	}

	getNodesDisagreeingOnExternalizedValue(): Set<NodeId> {
		let nodes = new Set<NodeId>();
		if (this.externalizedValue === undefined) return nodes;

		Array.from(this.valuesMap.keys())
			.filter((value) => value !== this.externalizedValue)
			.forEach((value) => {
				const otherNodes = this.valuesMap.get(value);
				if (otherNodes) nodes = new Set([...nodes, ...otherNodes]);
			});

		return nodes;
	}

	addExternalizeValue(nodeId: NodeId, value: SlotValue): void {
		let nodesThatExternalizedValue = this.valuesMap.get(value);
		if (!nodesThatExternalizedValue) {
			nodesThatExternalizedValue = new Set();
			this.valuesMap.set(value, nodesThatExternalizedValue);
		}

		if (nodesThatExternalizedValue.has(nodeId))
			//already recorded, no need to check if closed
			return;

		nodesThatExternalizedValue.add(nodeId);

		if (this.closed()) return;

		if (QuorumSet.getAllValidators(this.trustedQuorumSet).includes(nodeId)) {
			if (this.logger) {
				this.logger.debug(
					'Node part of trusted quorumSet, attempting slot close',
					{ node: nodeId }
				);
			}
			if (containsSlice(this.trustedQuorumSet, nodesThatExternalizedValue))
				//try to close slot
				this.externalizedValue = value;
		}
	}

	closed(): boolean {
		return this.externalizedValue !== undefined;
	}
}

export class Slots {
	protected slots: Map<SlotIndex, Slot> = new Map<SlotIndex, Slot>();
	protected trustedQuorumSet: QuorumSet;

	constructor(trustedQuorumSet: QuorumSet, protected logger: P.Logger) {
		this.trustedQuorumSet = trustedQuorumSet;
	}

	public getSlot(slotIndex: SlotIndex): Slot {
		let slot = this.slots.get(slotIndex);
		if (!slot) {
			slot = new Slot(slotIndex, this.trustedQuorumSet, this.logger);
			this.slots.set(slotIndex, slot);
		}

		return slot;
	}

	hasClosedSlot(): boolean {
		return this.getClosedSlotIndexes().length !== 0;
	}

	public getLatestSlotIndex(): bigint {
		return Array.from(this.slots.keys()).reduce(
			(l, r) => (r > l ? r : l),
			BigInt(0)
		);
	}

	getClosedSlotIndexes(): bigint[] {
		return Array.from(this.slots.values())
			.filter((slot) => slot.closed())
			.map((slot) => slot.index);
	}
}
