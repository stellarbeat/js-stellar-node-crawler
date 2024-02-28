import * as P from 'pino';
import { ok, Result } from 'neverthrow';
import { Slot } from './slots';
import { Ledger } from './crawler';
import { PeerNodeCollection } from './peer-node-collection';
import { ExternalizeData } from './map-externalize-statement';

//attempts slot closing and updates peer statuses accordingly
export class ExternalizeStatementHandler {
	constructor(private logger: P.Logger) {}

	//returns ledger if slot is closed
	public handle(
		peerNodes: PeerNodeCollection,
		slot: Slot,
		externalizeData: ExternalizeData,
		localCloseTime: Date
	): Result<Ledger | null, Error> {
		this.logExternalizeMessage(
			externalizeData.publicKey,
			slot.index,
			externalizeData.value
		);

		peerNodes.addExternalizedValueForPeerNode(
			externalizeData.publicKey,
			slot.index,
			externalizeData.value,
			localCloseTime
		);

		if (slot.closed()) {
			peerNodes.confirmLedgerClose(
				externalizeData.publicKey,
				slot.getClosedLedger()!
			);
			return ok(null);
		}

		const confirmationResult = this.attemptSlotCloseConfirmation(
			slot,
			externalizeData.publicKey,
			externalizeData.value
		);
		if (confirmationResult.isErr()) return confirmationResult;

		if (confirmationResult.value === null) return ok(null);

		this.confirmLedgerCloseForPeersThatHaveExternalized(
			confirmationResult.value,
			slot,
			peerNodes
		);

		return ok(confirmationResult.value);
	}

	private attemptSlotCloseConfirmation(
		slot: Slot,
		publicKey: string,
		value: string
	): Result<Ledger | null, Error> {
		slot.addExternalizeValue(publicKey, value);

		const closedLedger = slot.getClosedLedger();
		if (!closedLedger) return ok(null);

		return ok(closedLedger);
	}

	private confirmLedgerCloseForPeersThatHaveExternalized(
		closedLedger: Ledger,
		slot: Slot,
		peers: PeerNodeCollection
	) {
		this.logLedgerClose(closedLedger);
		peers.confirmLedgerCloseForValidatingNodes(
			slot.getNodesAgreeingOnExternalizedValue(),
			closedLedger
		);
		peers.confirmLedgerCloseForDisagreeingNodes(
			slot.getNodesDisagreeingOnExternalizedValue()
		);
	}

	private logExternalizeMessage(
		publicKey: string,
		slotIndex: bigint,
		value: string
	) {
		this.logger.debug(
			{
				publicKey: publicKey,
				slotIndex: slotIndex.toString(),
				value: value
			},
			'Processing externalize msg'
		);
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
}
