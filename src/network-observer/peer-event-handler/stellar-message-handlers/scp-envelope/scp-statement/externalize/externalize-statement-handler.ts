import * as P from 'pino';
import { Ledger } from '../../../../../../crawler';
import { PeerNodeCollection } from '../../../../../../peer-node-collection';
import { ExternalizeData } from './map-externalize-statement';
import { Slot } from './slot';
import * as assert from 'assert';

//attempts slot close confirmation and updates peer statuses accordingly
export class ExternalizeStatementHandler {
	constructor(private logger: P.Logger) {}

	//returns ledger if slot is closed
	public handle(
		peerNodes: PeerNodeCollection,
		slot: Slot,
		externalizeData: ExternalizeData,
		localCloseTime: Date,
		latestConfirmedClosedLedger: Ledger
	): Ledger | null {
		assert.equal(slot.index, externalizeData.slotIndex, 'Slot index mismatch');

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
			peerNodes.confirmLedgerCloseForNode(
				externalizeData.publicKey,
				closedLedger
			);
			return null;
		}

		//don't confirm older slots as this could mess with the lag detection
		//because nodes could relay/replay old externalize messages
		if (externalizeData.slotIndex <= latestConfirmedClosedLedger.sequence)
			return null;

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
