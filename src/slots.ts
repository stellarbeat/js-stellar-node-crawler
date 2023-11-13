import {QuorumSet} from '@stellarbeat/js-stellarbeat-shared';
import * as P from 'pino';
import {Slot, SlotIndex} from "./slot";

export class Slots {
	protected slots: Map<SlotIndex, Slot> = new Map<SlotIndex, Slot>();//todo: cleanup to avoid mem leaks
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

	/*hasClosedSlot(): boolean {
		return this.getClosedSlotIndexes().length !== 0;
	}

	public getLatestSlotIndex(): bigint {
		return Array.from(this.slots.keys()).reduce(
			(l, r) => (r > l ? r : l),
			BigInt(0)
		);
	}*/

	getClosedSlotIndexes(): bigint[] {
		return Array.from(this.slots.values())
			.filter((slot) => slot.closed())
			.map((slot) => slot.index);
	}
}
