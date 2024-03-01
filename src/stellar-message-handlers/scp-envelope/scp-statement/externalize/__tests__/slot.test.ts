import { Slot } from '../slot';
import { mock } from 'jest-mock-extended';
import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { P } from 'pino';
import { createDummyValue } from '../../../../../__fixtures__/createDummyExternalizeMessage';

const mockLogger = mock<P.Logger>();
let quorumSet: QuorumSet;

describe('slot', () => {
	beforeEach(() => {
		jest.resetAllMocks();
		quorumSet = new QuorumSet(2, ['A', 'B', 'C'], []);
	});

	it('should return empty set if no confirmed closed ledger', () => {
		const slot = new Slot(BigInt(1), quorumSet, mockLogger);
		slot.addExternalizeValue('A', 'test value', new Date());
		expect(slot.getNodesAgreeingOnExternalizedValue()).toEqual(new Set());
	});

	it('should return agreeing and disagreeing nodes when ledger close is confirmed', () => {
		const slot = new Slot(BigInt(1), quorumSet, mockLogger);
		slot.addExternalizeValue('A', 'test value', new Date());
		slot.addExternalizeValue('B', 'test value', new Date());
		slot.addExternalizeValue('C', 'another value', new Date());

		expect(slot.getNodesAgreeingOnExternalizedValue()).toEqual(
			new Set(['A', 'B'])
		);
		expect(slot.getNodesDisagreeingOnExternalizedValue()).toEqual(
			new Set(['C'])
		);
	});

	it('should return empty set if no confirmed closed ledger', () => {
		const slot = new Slot(BigInt(1), mock<QuorumSet>(), mockLogger);
		expect(slot.getNodesDisagreeingOnExternalizedValue()).toEqual(new Set());
	});

	it('should close slot and return ledger', () => {
		const value = createDummyValue();
		const slot = new Slot(BigInt(100), quorumSet, mockLogger);
		const firstObservedTime = new Date('2021-01-01T00:00:00Z');
		const secondObservedTime = new Date('2021-01-02T00:00:01Z');

		slot.addExternalizeValue('A', value.toString('base64'), firstObservedTime);
		slot.addExternalizeValue('B', value.toString('base64'), secondObservedTime);

		expect(slot.getNodesAgreeingOnExternalizedValue()).toEqual(
			new Set(['A', 'B'])
		);
		expect(slot.getConfirmedClosedLedger()).toEqual({
			value: value.toString('base64'),
			closeTime: new Date('2024-02-27T08:36:24.000Z'),
			localCloseTime: firstObservedTime,
			sequence: BigInt(100)
		});
	});
});
