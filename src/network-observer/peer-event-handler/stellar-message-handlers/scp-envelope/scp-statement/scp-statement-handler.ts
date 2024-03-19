import * as P from 'pino';
import { xdr } from '@stellar/stellar-base';
import { getPublicKeyStringFromBuffer } from '@stellarbeat/js-stellar-node-connector';
import { QuorumSetManager } from '../../../../quorum-set-manager';
import { err, ok, Result } from 'neverthrow';
import { ExternalizeStatementHandler } from './externalize/externalize-statement-handler';
import { mapExternalizeStatement } from './externalize/map-externalize-statement';
import { Ledger } from '../../../../../crawler';
import { Observation } from '../../../../observation';

export class ScpStatementHandler {
	constructor(
		private quorumSetManager: QuorumSetManager,
		private externalizeStatementHandler: ExternalizeStatementHandler,
		private logger: P.Logger
	) {}

	public handle(
		scpStatement: xdr.ScpStatement,
		observation: Observation
	): Result<
		{
			closedLedger: Ledger | null;
		},
		Error
	> {
		const publicKeyResult = getPublicKeyStringFromBuffer(
			scpStatement.nodeId().value()
		);
		if (publicKeyResult.isErr()) {
			return err(publicKeyResult.error);
		}

		const publicKey = publicKeyResult.value;
		const slotIndex = BigInt(scpStatement.slotIndex().toString());

		this.logger.debug(
			{
				publicKey: publicKey,
				slotIndex: slotIndex.toString()
			},
			'processing new scp statement: ' + scpStatement.pledges().switch().name
		);

		const peer = observation.peerNodes.getOrAdd(publicKey); //maybe we got a relayed message from a peer that we have not crawled yet
		peer.participatingInSCP = true;
		peer.latestActiveSlotIndex = slotIndex.toString();

		this.quorumSetManager.processQuorumSetHashFromStatement(
			peer,
			scpStatement,
			observation
		);

		if (
			scpStatement.pledges().switch().value !==
			xdr.ScpStatementType.scpStExternalize().value
		) {
			//only if node is externalizing, we mark the node as validating
			return ok({
				closedLedger: null
			});
		}

		const externalizeData = mapExternalizeStatement(scpStatement);
		if (!externalizeData.isOk()) {
			return err(externalizeData.error);
		}

		const closedLedgerOrNull = this.externalizeStatementHandler.handle(
			observation.peerNodes,
			observation.slots.getSlot(slotIndex),
			externalizeData.value,
			new Date(), //todo: move up,
			observation.latestConfirmedClosedLedger
		);

		if (
			closedLedgerOrNull !== null &&
			closedLedgerOrNull.sequence >
				observation.latestConfirmedClosedLedger.sequence
		) {
			return ok({
				closedLedger: closedLedgerOrNull
			});
		}

		return ok({
			closedLedger: null
		});
	}
}
