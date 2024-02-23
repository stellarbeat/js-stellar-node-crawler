import { mock, MockProxy } from 'jest-mock-extended';
import { hash, Networks } from '@stellar/stellar-base';
import { LedgerCloseScpEnvelopeHandler } from '../../src/ledger-close-detector/ledger-close-scp-envelope-handler';
import { P } from 'pino';
import { SlotCloser } from '../../src/ledger-close-detector/slot-closer';
import { createDummyExternalizeMessage } from '../../fixtures/createDummyExternalizeMessage';

let slotCloser: SlotCloser & MockProxy<SlotCloser>;
let ledgerCloseSCPEnvelopeHandler: LedgerCloseScpEnvelopeHandler;

describe('LedgerCloseScpEnvelopeHandler', () => {
	beforeEach(() => {
		slotCloser = mock<SlotCloser>();
		ledgerCloseSCPEnvelopeHandler = new LedgerCloseScpEnvelopeHandler(
			slotCloser,
			mock<P.Logger>()
		);
		jest.clearAllMocks();
	});

	test('should return new ledger on valid externalize ledger that closes slot', () => {
		const stellarMessage = createDummyExternalizeMessage();

		const ledger = {
			sequence: BigInt(1),
			closeTime: new Date()
		};
		slotCloser.attemptSlotClose.mockReturnValueOnce(ledger);

		const result = ledgerCloseSCPEnvelopeHandler.handleScpEnvelope(
			stellarMessage.envelope(),
			hash(Buffer.from(Networks.PUBLIC))
		);

		expect(result.isOk()).toBeTruthy();
		if (!result.isOk()) {
			throw new Error('result is not ok');
		}
		expect(result.value).toEqual(ledger);
		expect(slotCloser.attemptSlotClose).toHaveBeenCalled();
	});

	test('should return undefined on valid externalize ledger that does not close slot', () => {
		const stellarMessage = createDummyExternalizeMessage();

		slotCloser.attemptSlotClose.mockReturnValueOnce(undefined);

		const result = ledgerCloseSCPEnvelopeHandler.handleScpEnvelope(
			stellarMessage.envelope(),
			hash(Buffer.from(Networks.PUBLIC))
		);

		expect(result.isOk()).toBeTruthy();
		if (!result.isOk()) {
			throw new Error('result is not ok');
		}
		expect(result.value).toBeUndefined();
		expect(slotCloser.attemptSlotClose).toHaveBeenCalled();
	});

	test('should return error on invalid SCP envelope signature', () => {
		const stellarMessage = createDummyExternalizeMessage();
		stellarMessage.envelope().signature(Buffer.alloc(64));

		const result = ledgerCloseSCPEnvelopeHandler.handleScpEnvelope(
			stellarMessage.envelope(),
			hash(Buffer.from(Networks.PUBLIC))
		);

		expect(result.isOk()).toBeFalsy();
		if (result.isOk()) {
			throw new Error('result is ok');
		}
		expect(result.error).toBeInstanceOf(Error);
		expect(slotCloser.attemptSlotClose).toHaveBeenCalledTimes(0);
		expect(result.error.message).toEqual('Invalid SCP Signature');
	});

	test('should return error when it cannot verify envelope signature', () => {
		const stellarMessage = createDummyExternalizeMessage();
		stellarMessage.envelope().signature(Buffer.alloc(3));

		const result = ledgerCloseSCPEnvelopeHandler.handleScpEnvelope(
			stellarMessage.envelope(),
			hash(Buffer.from(Networks.PUBLIC))
		);

		expect(result.isOk()).toBeFalsy();
		if (result.isOk()) {
			throw new Error('result is ok');
		}
		expect(result.error).toBeInstanceOf(Error);
		expect(slotCloser.attemptSlotClose).toHaveBeenCalledTimes(0);
		expect(result.error.message).toEqual('Error verifying SCP Signature');
	});
});
