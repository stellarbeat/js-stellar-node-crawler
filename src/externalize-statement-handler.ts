import * as P from 'pino';
import { PeerNode } from './peer-node';
import { xdr } from '@stellar/stellar-base';
import { CrawlState } from './crawl-state';
import { err, ok, Result } from 'neverthrow';
import { extractCloseTimeFromValue } from './ledger-close-detector/extract-close-time-from-value';
import { Ledger } from './crawler';

export class ExternalizeStatementHandler {
	protected logger: P.Logger;

	constructor(logger: P.Logger) {
		this.logger = logger;
	}

	public handle(
		peer: PeerNode,
		slotIndex: bigint,
		statementExternalize: xdr.ScpStatementExternalize,
		crawlState: CrawlState
	): Result<undefined, Error> {
		const value = statementExternalize.commit().value().toString('base64');
		this.logger.debug(
			{
				publicKey: peer.publicKey,
				slotIndex: slotIndex.toString()
			},
			'externalize msg with value: ' + value
		);

		peer.externalizedValues.set(slotIndex, {
			localTime: new Date(),
			value: value
		});

		const markNodeAsValidating = (peer: PeerNode, ledger: Ledger) => {
			if (peer.successfullyConnected && !peer.disconnected) {
				peer.observedLedgerCloses++;
			}
			if (!peer.isValidating) {
				this.logger.debug(
					{
						pk: peer.publicKey
					},
					'Validating'
				);
			}
			peer.isValidating = true;
			peer.updateLag(ledger);
		};

		const slot = crawlState.slots.getSlot(slotIndex);
		const slotWasClosedBefore = slot.closed();
		slot.addExternalizeValue(peer.publicKey, value);

		if (slot.closed()) {
			const closedLedger = slot.getClosedLedger();
			if (!closedLedger) return err(new Error('Closed ledger is undefined'));
			if (!slotWasClosedBefore) {
				//we just closed the slot, lets mark all nodes as validating!
				this.logger.info(
					{
						sequence: closedLedger.sequence,
						closeTime: closedLedger.closeTime,
						localCloseTime: closedLedger.localCloseTime
					},
					'Ledger closed!'
				);
				if (slotIndex > crawlState.latestClosedLedger.sequence) {
					crawlState.latestClosedLedger = {
						sequence: slotIndex,
						closeTime: extractCloseTimeFromValue(Buffer.from(value, 'base64')),
						value: value,
						localCloseTime: new Date()
					};
				}
				slot
					.getNodesAgreeingOnExternalizedValue()
					.forEach((validatingPublicKey) => {
						const validatingPeer =
							crawlState.peerNodes.get(validatingPublicKey);
						if (validatingPeer)
							markNodeAsValidating(validatingPeer, closedLedger);
					});
				slot.getNodesDisagreeingOnExternalizedValue().forEach((nodeId) => {
					const badPeer = crawlState.peerNodes.get(nodeId);
					if (badPeer) badPeer.isValidatingIncorrectValues = true;
				});
			} else {
				//if the slot was already closed, we check if this new (?) node should be marked as validating
				if (value === slot.externalizedValue)
					markNodeAsValidating(peer, closedLedger);
				else peer.isValidatingIncorrectValues = true;
			}
		}

		return ok(undefined);
	}
}
