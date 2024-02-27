import * as P from 'pino';
import { PeerNode } from './peer-node';
import { hash, xdr } from '@stellar/stellar-base';
import { CrawlState } from './crawl-state';
import {
	getPublicKeyStringFromBuffer,
	verifySCPEnvelopeSignature
} from '@stellarbeat/js-stellar-node-connector';
import { QuorumSetManager } from './quorum-set-manager';
import { err, ok, Result } from 'neverthrow';
import { isLedgerSequenceValid } from './ledger-validator';
import { extractCloseTimeFromValue } from './ledger-close-detector/extract-close-time-from-value';
import { Ledger } from './crawler';

export class ScpEnvelopeHandler {
	constructor(
		private quorumSetManager: QuorumSetManager,
		private logger: P.Logger
	) {}

	public processScpEnvelope(
		scpEnvelope: xdr.ScpEnvelope,
		crawlState: CrawlState
	): Result<undefined, Error> {
		if (crawlState.envelopeCache.has(scpEnvelope.signature().toString())) {
			return ok(undefined);
		}
		crawlState.envelopeCache.set(scpEnvelope.signature().toString(), 1);

		if (
			!isLedgerSequenceValid(
				crawlState.latestClosedLedger,
				BigInt(scpEnvelope.statement().slotIndex().toString())
			)
		)
			return ok(undefined);

		const verifiedResult = verifySCPEnvelopeSignature(
			scpEnvelope,
			hash(Buffer.from(crawlState.network))
		);
		if (verifiedResult.isErr())
			return err(new Error('Error verifying SCP Signature'));

		if (!verifiedResult.value) return err(new Error('Invalid SCP Signature'));

		return this.processScpStatement(scpEnvelope.statement(), crawlState);
	}

	protected processScpStatement(
		scpStatement: xdr.ScpStatement,
		crawlState: CrawlState
	): Result<undefined, Error> {
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

		const peer = crawlState.peerNodes.addIfNotExists(publicKey);
		peer.participatingInSCP = true;
		peer.latestActiveSlotIndex = slotIndex.toString();

		this.quorumSetManager.processQuorumSetHashFromStatement(
			peer,
			scpStatement,
			crawlState
		);

		if (
			scpStatement.pledges().switch().value !==
			xdr.ScpStatementType.scpStExternalize().value
		) {
			//only if node is externalizing, we mark the node as validating
			return ok(undefined);
		}

		return this.processExternalizeStatement(
			peer,
			slotIndex,
			scpStatement.pledges().externalize(),
			crawlState
		);
	}

	protected processExternalizeStatement(
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
