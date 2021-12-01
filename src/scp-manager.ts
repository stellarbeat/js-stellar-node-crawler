import * as P from 'pino';
import { PeerNode } from './peer-node';
import { hash, Networks, xdr } from 'stellar-base';
import { CrawlState } from './crawl-state';
import {
	getPublicKeyStringFromBuffer,
	verifySCPEnvelopeSignature
} from '@stellarbeat/js-stellar-node-connector';
import { QuorumSetManager } from './quorum-set-manager';
import { err, ok, Result } from 'neverthrow';
import { isLedgerSequenceValid } from './ledger-validator';

export class ScpManager {
	protected logger: P.Logger;
	protected quorumSetManager: QuorumSetManager;

	constructor(quorumSetManager: QuorumSetManager, logger: P.Logger) {
		this.logger = logger;
		this.quorumSetManager = quorumSetManager;
	}

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
			hash(Buffer.from(Networks.PUBLIC))
		);
		if (verifiedResult.isErr()) return err(new Error('Invalid SCP Signature'));

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

		let peer = crawlState.peerNodes.get(publicKey);
		if (!peer) {
			peer = new PeerNode(publicKey);
			crawlState.peerNodes.set(publicKey, peer);
		}

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

		const markNodeAsValidating = (peer: PeerNode) => {
			if (!peer.isValidating) {
				this.logger.debug(
					{
						pk: peer.publicKey
					},
					'Validating'
				);
			}
			peer.isValidating = true;
		};

		const slot = crawlState.slots.getSlot(slotIndex);
		const slotWasClosedBefore = slot.closed();
		slot.addExternalizeValue(peer.publicKey, value);

		if (slot.closed()) {
			if (!slotWasClosedBefore) {
				//we just closed the slot, lets mark all nodes as validating!
				this.logger.info({ ledger: slotIndex.toString() }, 'Ledger closed!');
				if (slotIndex > crawlState.latestClosedLedger.sequence) {
					crawlState.latestClosedLedger = {
						sequence: slotIndex,
						closeTime: new Date()
					};
				}
				slot
					.getNodesAgreeingOnExternalizedValue()
					.forEach((validatingPublicKey) => {
						const validatingPeer =
							crawlState.peerNodes.get(validatingPublicKey);
						if (validatingPeer) markNodeAsValidating(validatingPeer);
					});
				slot.getNodesDisagreeingOnExternalizedValue().forEach((nodeId) => {
					const badPeer = crawlState.peerNodes.get(nodeId);
					if (badPeer) badPeer.isValidatingIncorrectValues = true;
				});
			} else {
				//if the slot was already closed, we check if this new (?) node should be marked as validating
				if (value === slot.externalizedValue) markNodeAsValidating(peer);
				else peer.isValidatingIncorrectValues = true;
			}
		}

		return ok(undefined);
	}
}
