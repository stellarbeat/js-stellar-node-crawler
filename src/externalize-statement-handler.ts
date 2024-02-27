import * as P from 'pino';
import { PeerNode } from './peer-node';
import { xdr } from '@stellar/stellar-base';
import { CrawlState } from './crawl-state';
import { ok, Result } from 'neverthrow';
import { extractCloseTimeFromValue } from './ledger-close-detector/extract-close-time-from-value';
import { Slot } from './slots';
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
		const value = this.getCommitValue(statementExternalize);
		this.logExternalizeMessage(peer, slotIndex, value);

		this.registerExternalizedValueForPeer(peer, slotIndex, value);

		const slot = crawlState.slots.getSlot(slotIndex);

		if (slot.closed()) {
			this.validateExternalizedValueForPeer(value, slot, peer);
			return ok(undefined);
		}

		return this.attemptSlotClose(slot, peer, value, slotIndex, crawlState);
	}

	private attemptSlotClose(
		slot: Slot,
		peer: PeerNode,
		value: string,
		slotIndex: bigint,
		crawlState: CrawlState
	) {
		slot.addExternalizeValue(peer.publicKey, value);

		const closedLedger = slot.getClosedLedger();
		if (!slot.closed() || !closedLedger) return ok(undefined);

		this.onSlotClose(closedLedger, slotIndex, crawlState, value, slot);

		return ok(undefined);
	}

	private validateExternalizedValueForPeer(
		value: string,
		slot: Slot,
		peer: PeerNode
	) {
		if (value === slot.externalizedValue && slot.getClosedLedger())
			peer.externalizedValueIsValidated(slot.getClosedLedger()!);
		else peer.isValidatingIncorrectValues = true;
	}

	private onSlotClose(
		closedLedger: Ledger,
		slotIndex: bigint,
		crawlState: CrawlState,
		value: string,
		slot: Slot
	) {
		this.logLedgerClose(closedLedger);
		if (slotIndex > crawlState.latestClosedLedger.sequence) {
			crawlState.latestClosedLedger = {
				sequence: slotIndex,
				closeTime: extractCloseTimeFromValue(Buffer.from(value, 'base64')),
				value: value,
				localCloseTime: new Date()
			};
		}
		this.processAgreeingNodes(slot, crawlState, closedLedger);
		this.processDisagreeingNodes(slot, crawlState);
	}

	private logLedgerClose(closedLedger: Ledger) {
		this.logger.info(
			{
				sequence: closedLedger.sequence,
				closeTime: closedLedger.closeTime,
				localCloseTime: closedLedger.localCloseTime
			},
			'Ledger closed!'
		);
	}

	private processDisagreeingNodes(slot: Slot, crawlState: CrawlState) {
		slot.getNodesDisagreeingOnExternalizedValue().forEach((nodeId) => {
			const badPeer = crawlState.peerNodes.get(nodeId);
			if (badPeer) badPeer.isValidatingIncorrectValues = true;
		});
	}

	private processAgreeingNodes(
		slot: Slot,
		crawlState: CrawlState,
		closedLedger: Ledger
	) {
		slot
			.getNodesAgreeingOnExternalizedValue()
			.forEach((validatingPublicKey) => {
				const validatingPeer = crawlState.peerNodes.get(validatingPublicKey);
				if (validatingPeer)
					validatingPeer.externalizedValueIsValidated(closedLedger);
			});
	}

	private registerExternalizedValueForPeer(
		peer: PeerNode,
		slotIndex: bigint,
		value: string
	) {
		peer.externalizedValues.set(slotIndex, {
			localTime: new Date(),
			value: value
		});
	}

	private logExternalizeMessage(
		peer: PeerNode,
		slotIndex: bigint,
		value: string
	) {
		this.logger.debug(
			{
				publicKey: peer.publicKey,
				slotIndex: slotIndex.toString()
			},
			'externalize msg with value: ' + value
		);
	}

	private getCommitValue(statementExternalize: xdr.ScpStatementExternalize) {
		return statementExternalize.commit().value().toString('base64');
	}
}
