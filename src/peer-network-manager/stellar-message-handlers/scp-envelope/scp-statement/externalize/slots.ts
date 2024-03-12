import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import * as P from 'pino';
import { Slot, SlotIndex } from './slot';

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

	getConfirmedClosedSlotIndexes(): bigint[] {
		return Array.from(this.slots.values())
			.filter((slot) => slot.confirmedClosed())
			.map((slot) => slot.index);
	}
}
