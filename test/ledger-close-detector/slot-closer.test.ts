import { mock, MockProxy } from 'jest-mock-extended';
import { PublicKey } from '@stellarbeat/js-stellarbeat-shared';
import { Slots } from '../../src/slots';
import { SlotCloser } from '../../src/ledger-close-detector/slot-closer';
import { P } from 'pino';
import { Slot } from '../../src/slot';

let mockSlots: MockProxy<Slots>;
let slotCloser: SlotCloser;
let publicKey: PublicKey;
let value: string;
let logger: P.Logger;

beforeEach(() => {
	logger = mock<P.Logger>();
	mockSlots = mock<Slots>();
	slotCloser = new SlotCloser();
	publicKey = 'GABC...XYZ';
	value = 'test value';
});

test('should attempt to close slot and return ledger', () => {
	const newlyClosedSlotIndex = BigInt(1);

	const slot = mock<Slot>();
	slot.confirmedClosed.mockReturnValueOnce(false).mockReturnValueOnce(true);
	mockSlots.getSlot.mockReturnValue(slot);

	const ledger = slotCloser.attemptSlotClose(
		mockSlots,
		publicKey,
		newlyClosedSlotIndex,
		value
	);
	expect(ledger).toBeDefined();
	if (!ledger) {
		throw new Error('ledger is undefined');
	}
	expect(ledger.sequence).toEqual(newlyClosedSlotIndex);
	expect(mockSlots.getSlot).toHaveBeenCalledWith(newlyClosedSlotIndex);
});

test('should attempt to close slot and return undefined if slot was closed before', () => {
	const attemptedSlotIndex = BigInt(1);

	const slot = mock<Slot>();
	slot.confirmedClosed.mockReturnValueOnce(true);
	mockSlots.getSlot.mockReturnValue(slot);

	const ledger = slotCloser.attemptSlotClose(
		mockSlots,
		publicKey,
		attemptedSlotIndex,
		value
	);
	expect(ledger).toBeUndefined();
	expect(mockSlots.getSlot).toHaveBeenCalledWith(attemptedSlotIndex);
	expect(slot.addExternalizeValue).toHaveBeenCalledTimes(0);
});
