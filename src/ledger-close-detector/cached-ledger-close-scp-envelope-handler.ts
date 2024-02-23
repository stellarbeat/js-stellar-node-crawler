import { xdr } from '@stellar/stellar-base';
import { err, ok, Result } from 'neverthrow';
import * as LRUCache from 'lru-cache';
import { Ledger } from '../crawler';
import { LedgerCloseScpEnvelopeHandler } from './ledger-close-scp-envelope-handler';

export class CachedLedgerCloseScpEnvelopeHandler {
	private envelopeCache: LRUCache<string, number> = new LRUCache<
		string,
		number
	>(5000); //todo: configurable

	constructor(
		private ledgerCloseScpEnvelopeHandler: LedgerCloseScpEnvelopeHandler
	) {}

	//returns a ledger if a ledger was closed, undefined if not
	public handleScpEnvelope(
		scpEnvelope: xdr.ScpEnvelope,
		networkHash: Buffer
	): Result<undefined | Ledger, Error> {
		if (this.envelopeCache.has(scpEnvelope.signature().toString())) {
			return ok(undefined);
		}
		this.envelopeCache.set(scpEnvelope.signature().toString(), 1);

		return this.ledgerCloseScpEnvelopeHandler.handleScpEnvelope(
			scpEnvelope,
			networkHash
		);
	}
}