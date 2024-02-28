import { Slots } from '../slots';
import { PublicKey } from '@stellarbeat/js-stellarbeat-shared';
import { Ledger } from '../crawler';
import { xdr } from '@stellar/stellar-base';
import { extractCloseTimeFromValue } from './extract-close-time-from-value';

export class SlotCloser {
	constructor() {}

	public attemptSlotClose(
		slots: Slots,
		publicKey: PublicKey,
		slotIndex: bigint,
		value: string
	): Ledger | undefined {
		const slot = slots.getSlot(slotIndex);
		if (slot.confirmedClosed()) return; //nothing to do here

		slot.addExternalizeValue(publicKey, value);

		if (!slot.confirmedClosed()) return undefined;

		return {
			sequence: slotIndex,
			localCloseTime: new Date(),
			closeTime: extractCloseTimeFromValue(Buffer.from(value, 'base64')),
			value: value
		};
	}
}
