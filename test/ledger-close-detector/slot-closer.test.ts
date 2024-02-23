import { mock, MockProxy } from 'jest-mock-extended';
import { PublicKey } from '@stellarbeat/js-stellarbeat-shared';
import { Slot, Slots } from '../../src/slots';
import { SlotCloser } from '../../src/ledger-close-detector/slot-closer';
import { Ledger } from '../../src/crawler';
import { P } from 'pino';

let mockSlots: MockProxy<Slots>;
let slotCloser: SlotCloser;
let publicKey: PublicKey;
let value: string;
let logger: P.Logger;

beforeEach(() => {
	logger = mock<P.Logger>();
	mockSlots = mock<Slots>();
	slotCloser = new SlotCloser(mockSlots, logger);
	publicKey = 'GABC...XYZ';
	value = 'test value';
});

test('should attempt to close slot and return ledger', () => {
	const newlyClosedSlotIndex = BigInt(1);

	const slot = mock<Slot>();
	slot.closed.mockReturnValueOnce(false).mockReturnValueOnce(true);
	mockSlots.getSlot.mockReturnValue(slot);

	const ledger = slotCloser.attemptSlotClose(
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
	expect(slot.addExternalizeValue).toHaveBeenCalledWith(publicKey, value);
});

test('should attempt to close slot and return undefined if slot was closed before', () => {
	const attemptedSlotIndex = BigInt(1);

	const slot = mock<Slot>();
	slot.closed.mockReturnValueOnce(true);
	mockSlots.getSlot.mockReturnValue(slot);

	const ledger = slotCloser.attemptSlotClose(
		publicKey,
		attemptedSlotIndex,
		value
	);
	expect(ledger).toBeUndefined();
	expect(mockSlots.getSlot).toHaveBeenCalledWith(attemptedSlotIndex);
	expect(slot.addExternalizeValue).toHaveBeenCalledTimes(0);
});
