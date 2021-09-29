import containsSlice from '@stellarbeat/js-stellar-domain/lib/quorum/containsSlice';
import { QuorumSet } from '@stellarbeat/js-stellar-domain';

type SlotIndex = bigint;
type NodeId = string;
type SlotValue = string;

export class Slot {
	public index: SlotIndex;
	public externalizedValue?: SlotValue;
	protected valuesMap: Map<SlotValue, Set<NodeId>> = new Map();
	protected trustedQuorumSet: QuorumSet;

	constructor(index: SlotIndex, trustedQuorumSet: QuorumSet) {
		this.index = index;
		this.trustedQuorumSet = trustedQuorumSet;
	}

	getNodesAgreeingOnExternalizedValue(): Set<NodeId> {
		if (this.externalizedValue === undefined) return new Set();

		return this.valuesMap.get(this.externalizedValue)!;
	}

	getNodesDisagreeingOnExternalizedValue(): Set<NodeId> {
		let nodes = new Set<NodeId>();
		if (this.externalizedValue === undefined) return nodes;

		Array.from(this.valuesMap.keys())
			.filter((value) => value !== this.externalizedValue)
			.forEach((value) => {
				nodes = new Set([...nodes, ...this.valuesMap.get(value)!]);
			});

		return nodes;
	}

	addExternalizeValue(nodeId: NodeId, value: SlotValue) {
		let nodes = this.valuesMap.get(value);
		if (!nodes) {
			nodes = new Set();
			this.valuesMap.set(value, nodes);
		}

		if (nodes.has(nodeId))
			//already recorded, no need to check if closed
			return;

		nodes.add(nodeId);

		if (this.closed()) return;

		if (containsSlice(this.trustedQuorumSet, nodes))
			//try to close slot
			this.externalizedValue = value;
	}

	closed() {
		return this.externalizedValue !== undefined;
	}
}

export class Slots {
	protected slots: Map<SlotIndex, Slot> = new Map<SlotIndex, Slot>();
	protected trustedQuorumSet: QuorumSet;

	constructor(trustedQuorumSet: QuorumSet) {
		this.trustedQuorumSet = trustedQuorumSet;
	}

	public getSlot(slotIndex: SlotIndex) {
		let slot = this.slots.get(slotIndex);
		if (!slot) {
			slot = new Slot(slotIndex, this.trustedQuorumSet);
			this.slots.set(slotIndex, slot);
		}

		return slot;
	}

	hasClosedSlot() {
		return this.getClosedSlotIndexes().length !== 0;
	}

	public getLatestSlotIndex() {
		return Array.from(this.slots.keys()).reduce(
			(l, r) => (r > l ? r : l),
			BigInt(0)
		);
	}

	getClosedSlotIndexes() {
		return Array.from(this.slots.values())
			.filter((slot) => slot.closed())
			.map((slot) => slot.index);
	}
}
