import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { mock } from 'jest-mock-extended';
import { P } from 'pino';
import { Slots } from '../src/message-handlers/externalize/slots';

describe('slots', () => {
	it('should create new slot', () => {
		const trustedQuorumSet = new QuorumSet(2, ['A', 'B', 'C'], []);
		const logger = mock<P.Logger>();
		const slots = new Slots(trustedQuorumSet, logger);
		const slot = slots.getSlot(BigInt(1));
		expect(slot).toBeDefined();
		expect(slot.index).toEqual(BigInt(1));
	});

	it('should return same slot if already created', () => {
		const trustedQuorumSet = new QuorumSet(2, ['A', 'B', 'C'], []);
		const logger = mock<P.Logger>();
		const slots = new Slots(trustedQuorumSet, logger);
		const slot = slots.getSlot(BigInt(1));
		const slot2 = slots.getSlot(BigInt(1));
		expect(slot).toBe(slot2);
	});

	it('should return empty set if no confirmed closed ledger', () => {
		const trustedQuorumSet = new QuorumSet(2, ['A', 'B', 'C'], []);
		const logger = mock<P.Logger>();
		const slots = new Slots(trustedQuorumSet, logger);
		slots.getSlot(BigInt(1));
		expect(slots.getConfirmedClosedSlotIndexes()).toEqual([]);
	});

	it('should return confirmed closed slot indexes', () => {
		const trustedQuorumSet = new QuorumSet(1, ['A'], []);
		const logger = mock<P.Logger>();
		const slots = new Slots(trustedQuorumSet, logger);
		const slot = slots.getSlot(BigInt(1));
		slot.addExternalizeValue('A', 'test value', new Date());
		const slot2 = slots.getSlot(BigInt(2));

		expect(slots.getConfirmedClosedSlotIndexes()).toEqual([BigInt(1)]);
	});
});
