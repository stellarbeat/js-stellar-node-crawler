import { mock } from 'jest-mock-extended';
import * as P from 'pino';
import { PeerNodeCollection } from '../src/peer-node-collection';
import { Slot } from '../src/slots';
import { ExternalizeStatementHandler } from '../src/externalize-statement-handler';
import { ExternalizeData } from '../src/map-externalize-statement';
import { Ledger } from '../src/crawler';

const mockLogger = mock<P.Logger>();

describe('ExternalizeStatementHandler', () => {
	beforeEach(() => {
		jest.resetAllMocks();
	});

	it('should confirm ledger close for peer if slot was already confirmed closed', () => {
		const mockPeerNodes = mock<PeerNodeCollection>();
		const mockSlot = mock<Slot>();
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
		mockSlot.getClosedLedger.mockReturnValueOnce(closedLedger);

		const result = handler.handle(
			mockPeerNodes,
			mockSlot,
			externalizeData,
			localSlotCloseTime
		);

		expect(result).toBe(null);
		expect(mockPeerNodes.confirmLedgerClose).toHaveBeenCalledWith(
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
		const slotCloseTime = new Date();
		const localSlotCloseTime = new Date();
		const externalizeData: ExternalizeData = {
			publicKey: 'A',
			value: 'test value',
			closeTime: slotCloseTime,
			slotIndex: BigInt(1)
		};

		const handler = new ExternalizeStatementHandler(mockLogger);
		mockSlot.getClosedLedger.mockReturnValueOnce(undefined);

		const result = handler.handle(
			mockPeerNodes,
			mockSlot,
			externalizeData,
			localSlotCloseTime
		);

		expect(result).toBe(null);
		expect(mockPeerNodes.confirmLedgerClose).not.toHaveBeenCalled();
		expect(mockPeerNodes.addExternalizedValueForPeerNode).toHaveBeenCalledTimes(
			1
		);
	});

	it('should return ledger and update nodes if slot is confirmed closed after attempt', () => {
		const mockPeerNodes = mock<PeerNodeCollection>();
		const mockSlot = mock<Slot>();
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

		mockSlot.getClosedLedger.mockReturnValueOnce(undefined);
		mockSlot.getClosedLedger.mockReturnValueOnce(closedLedger);

		const result = handler.handle(
			mockPeerNodes,
			mockSlot,
			externalizeData,
			localSlotCloseTime
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
