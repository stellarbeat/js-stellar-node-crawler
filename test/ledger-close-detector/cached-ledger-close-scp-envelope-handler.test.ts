import { mock, MockProxy } from 'jest-mock-extended';
import { hash, Keypair, Networks } from '@stellar/stellar-base';
import { LedgerCloseScpEnvelopeHandler } from '../../src/ledger-close-detector/ledger-close-scp-envelope-handler';
import { P } from 'pino';
import { SlotCloser } from '../../src/ledger-close-detector/slot-closer';
import { createDummyExternalizeMessage } from '../../fixtures/createDummyExternalizeMessage';
import { CachedLedgerCloseScpEnvelopeHandler } from '../../src/ledger-close-detector/cached-ledger-close-scp-envelope-handler';
import { ok } from 'neverthrow';

let ledgerCloseSCPEnvelopeHandler: LedgerCloseScpEnvelopeHandler &
	MockProxy<LedgerCloseScpEnvelopeHandler>;
let cachedLedgerCloseScpEnvelopeHandler: CachedLedgerCloseScpEnvelopeHandler;

describe('CachedLedgerCloseScpEnvelopeHandler', () => {
	beforeEach(() => {
		ledgerCloseSCPEnvelopeHandler = mock<LedgerCloseScpEnvelopeHandler>();
		cachedLedgerCloseScpEnvelopeHandler =
			new CachedLedgerCloseScpEnvelopeHandler(ledgerCloseSCPEnvelopeHandler);
		jest.clearAllMocks();
	});

	it('should cache', function () {
		const externalizeMessage = createDummyExternalizeMessage();
		const ledger = {
			sequence: BigInt(1),
			closeTime: new Date()
		};
		ledgerCloseSCPEnvelopeHandler.handleScpEnvelope.mockReturnValueOnce(
			ok(ledger)
		);

		const result = cachedLedgerCloseScpEnvelopeHandler.handleScpEnvelope(
			externalizeMessage.envelope(),
			hash(Buffer.from(Networks.PUBLIC))
		);
		expect(result.isOk()).toBeTruthy();
		if (result.isErr()) {
			throw new Error('result is not ok');
		}
		expect(result.value).toEqual(ledger);
		const cachedResult = cachedLedgerCloseScpEnvelopeHandler.handleScpEnvelope(
			externalizeMessage.envelope(),
			hash(Buffer.from(Networks.PUBLIC))
		);

		expect(cachedResult.isOk()).toBeTruthy();
		if (cachedResult.isErr()) {
			throw new Error('cached result is not ok');
		}
		expect(cachedResult.value).toBeUndefined();

		expect(
			ledgerCloseSCPEnvelopeHandler.handleScpEnvelope
		).toHaveBeenCalledTimes(1);
	});
});
