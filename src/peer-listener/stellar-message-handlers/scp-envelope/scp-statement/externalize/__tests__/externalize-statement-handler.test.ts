import { mock } from 'jest-mock-extended';
import * as P from 'pino';
import { PeerNodeCollection } from '../../../../../../peer-node-collection';
import { ExternalizeStatementHandler } from '../externalize-statement-handler';
import { ExternalizeData } from '../map-externalize-statement';
import { Ledger } from '../../../../../../crawler';
import { Slot } from '../slot';

const mockLogger = mock<P.Logger>();

describe('ExternalizeStatementHandler', () => {
	let latestConfirmedClosedLedger: Ledger;

	beforeEach(() => {
		latestConfirmedClosedLedger = {
			sequence: BigInt(0),
			closeTime: new Date(),
			value: 'test value',
			localCloseTime: new Date()
		};
		jest.resetAllMocks();
	});

	it('should not confirm ledger closes for older ledgers even if older slot has not been confirmed yet', () => {
		const mockPeerNodes = mock<PeerNodeCollection>();
		const mockSlot = mock<Slot>();
		mockSlot.index = BigInt(1);
		const slotCloseTime = new Date();
		const localSlotCloseTime = new Date();
		latestConfirmedClosedLedger.sequence = BigInt(2);
		const externalizeData: ExternalizeData = {
			publicKey: 'A',
			value: 'test value',
			closeTime: slotCloseTime,
			slotIndex: BigInt(1)
		};

		const handler = new ExternalizeStatementHandler(mockLogger);
		mockSlot.getConfirmedClosedLedger.mockReturnValueOnce(undefined);

		const result = handler.handle(
			mockPeerNodes,
			mockSlot,
			externalizeData,
			localSlotCloseTime,
			latestConfirmedClosedLedger
		);

		expect(result).toBe(null);
		expect(mockPeerNodes.confirmLedgerCloseForNode).not.toHaveBeenCalled();
		expect(mockPeerNodes.addExternalizedValueForPeerNode).toHaveBeenCalledTimes(
			1
		);
		expect(mockSlot.addExternalizeValue).toHaveBeenCalledTimes(0);
	});

	it('should confirm ledger close for peer if slot was already confirmed closed', () => {
		const mockPeerNodes = mock<PeerNodeCollection>();
		const mockSlot = mock<Slot>();
		mockSlot.index = BigInt(1);
		const slotCloseTime = new Date();
		const localSlotCloseTime = new Date();
		const externalizeData: ExternalizeData = {
			publicKey: 'A',
			value: 'test value',
			closeTime: slotCloseTime,
			slotIndex: BigInt(1)
		};

		const handler = new ExternalizeStatementHandler(mockLogger);
		const closedLedger: Ledger = {
			sequence: BigInt(1),
			closeTime: slotCloseTime,
			value: 'test value',
			localCloseTime: localSlotCloseTime
		};
		mockSlot.getConfirmedClosedLedger.mockReturnValueOnce(closedLedger);

		const result = handler.handle(
			mockPeerNodes,
			mockSlot,
			externalizeData,
			localSlotCloseTime,
			latestConfirmedClosedLedger
		);

		expect(result).toBe(null);
		expect(mockPeerNodes.confirmLedgerCloseForNode).toHaveBeenCalledWith(
			externalizeData.publicKey,
			closedLedger
		);
		expect(mockPeerNodes.addExternalizedValueForPeerNode).toHaveBeenCalledTimes(
			1
		);
	});

	it('should return null and not update any nodes if slot is not confirmed closed after attempt', () => {
		const mockPeerNodes = mock<PeerNodeCollection>();
		const mockSlot = mock<Slot>();
		mockSlot.index = BigInt(1);
		const slotCloseTime = new Date();
		const localSlotCloseTime = new Date();
		const externalizeData: ExternalizeData = {
			publicKey: 'A',
			value: 'test value',
			closeTime: slotCloseTime,
			slotIndex: BigInt(1)
		};

		const handler = new ExternalizeStatementHandler(mockLogger);
		mockSlot.getConfirmedClosedLedger.mockReturnValueOnce(undefined);

		const result = handler.handle(
			mockPeerNodes,
			mockSlot,
			externalizeData,
			localSlotCloseTime,
			latestConfirmedClosedLedger
		);

		expect(result).toBe(null);
		expect(mockPeerNodes.confirmLedgerCloseForNode).not.toHaveBeenCalled();
		expect(mockPeerNodes.addExternalizedValueForPeerNode).toHaveBeenCalledTimes(
			1
		);
	});

	it('should return ledger and update nodes if slot is confirmed closed after attempt', () => {
		const mockPeerNodes = mock<PeerNodeCollection>();
		const mockSlot = mock<Slot>();
		mockSlot.index = BigInt(1);
		const slotCloseTime = new Date();
		const localSlotCloseTime = new Date();
		const externalizeData: ExternalizeData = {
			publicKey: 'A',
			value: 'test value',
			closeTime: slotCloseTime,
			slotIndex: BigInt(1)
		};

		const handler = new ExternalizeStatementHandler(mockLogger);
		const closedLedger: Ledger = {
			sequence: BigInt(1),
			closeTime: slotCloseTime,
			value: 'test value',
			localCloseTime: localSlotCloseTime
		};

		mockSlot.getConfirmedClosedLedger.mockReturnValueOnce(undefined);
		mockSlot.getConfirmedClosedLedger.mockReturnValueOnce(closedLedger);

		const result = handler.handle(
			mockPeerNodes,
			mockSlot,
			externalizeData,
			localSlotCloseTime,
			latestConfirmedClosedLedger
		);

		expect(result).toBe(closedLedger);
		expect(
			mockPeerNodes.confirmLedgerCloseForValidatingNodes
		).toHaveBeenCalledTimes(1);
		expect(mockPeerNodes.addExternalizedValueForPeerNode).toHaveBeenCalledTimes(
			1
		);
		expect(
			mockPeerNodes.confirmLedgerCloseForDisagreeingNodes
		).toHaveBeenCalledTimes(1);
	});
});
