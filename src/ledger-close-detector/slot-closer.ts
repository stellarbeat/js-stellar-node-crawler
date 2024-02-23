import { Slots } from '../slots';
import { P } from 'pino';
import { PublicKey } from '@stellarbeat/js-stellarbeat-shared';
import { Ledger } from '../crawler';

export class SlotCloser {
	constructor(private slots: Slots, private logger: P.Logger) {}

	public attemptSlotClose(
		publicKey: PublicKey,
		slotIndex: bigint,
		value: string
	): Ledger | undefined {
		const slot = this.slots.getSlot(slotIndex);
		if (slot.closed()) return; //nothing to do here

		slot.addExternalizeValue(publicKey, value);

		if (!slot.closed()) return undefined;

		return {
			sequence: slotIndex,
			closeTime: new Date()
		};
	}
}
