import * as P from 'pino';
import { Ledger } from '../../../../crawler';
import { PeerNodeCollection } from '../../../../peer-node-collection';
import { ExternalizeData } from './map-externalize-statement';
import { Slot } from './slot';

//attempts slot close confirmation and updates peer statuses accordingly
export class ExternalizeStatementHandler {
	constructor(private logger: P.Logger) {}

	//returns ledger if slot is closed
	public handle(
		peerNodes: PeerNodeCollection,
		slot: Slot,
		externalizeData: ExternalizeData,
		localCloseTime: Date
	): Ledger | null {
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

		const closedLedger = slot.getConfirmedClosedLedger();
		if (closedLedger) {
			peerNodes.confirmLedgerClose(externalizeData.publicKey, closedLedger);
			return null;
		}

		const confirmedClosedSlotOrNull = this.attemptSlotCloseConfirmation(
			slot,
			externalizeData.publicKey,
			externalizeData.value
		);

		if (confirmedClosedSlotOrNull === null) return null;

		this.confirmLedgerCloseForPeersThatHaveExternalized(
			confirmedClosedSlotOrNull,
			slot,
			peerNodes
		);

		return confirmedClosedSlotOrNull;
	}

	private attemptSlotCloseConfirmation(
		slot: Slot,
		publicKey: string,
		value: string
	): null | Ledger {
		slot.addExternalizeValue(publicKey, value, new Date());

		const closedLedger = slot.getConfirmedClosedLedger();
		if (!closedLedger) return null;

		return closedLedger;
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
