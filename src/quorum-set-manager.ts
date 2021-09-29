import { PublicKey, QuorumSet } from '@stellarbeat/js-stellar-domain';
import * as P from 'pino';
import { Logger } from 'pino';
import { xdr } from 'stellar-base';
import { PeerNode } from './peer-node';
import { CrawlState } from './crawl-state';
import { err, ok, Result } from 'neverthrow';

type QuorumSetHash = string;

/**
 * Fetches quorumSets in a sequential way from connected nodes.
 * Makes sure every peerNode that sent an scp message with a hash, gets the correct quorumSet.
 */
export class QuorumSetManager {
	protected logger: Logger;

	constructor(logger: P.Logger) {
		this.logger = logger;
	}

	public processQuorumSetHashFromStatement(
		peer: PeerNode,
		scpStatement: xdr.ScpStatement,
		crawlState: CrawlState
	): void {
		const quorumSetHashResult = this.getQuorumSetHash(scpStatement);
		if (quorumSetHashResult.isErr()) return;

		peer.quorumSetHash = quorumSetHashResult.value;
		if (
			!this.getQuorumSetHashOwners(peer.quorumSetHash, crawlState).has(
				peer.publicKey
			)
		) {
			this.logger.debug(
				{ pk: peer.publicKey, hash: peer.quorumSetHash },
				'Detected new quorumSetHash'
			);
		}

		this.getQuorumSetHashOwners(peer.quorumSetHash, crawlState).add(
			peer.publicKey
		);

		if (crawlState.quorumSets.has(peer.quorumSetHash))
			peer.quorumSet = crawlState.quorumSets.get(peer.quorumSetHash);
		else {
			this.logger.debug(
				{ pk: peer.publicKey },
				'Unknown quorumSet for hash: ' + peer.quorumSetHash
			);
			this.requestQuorumSet(peer.quorumSetHash, crawlState);
		}
	}

	public processQuorumSet(
		quorumSet: QuorumSet,
		sender: PublicKey,
		crawlState: CrawlState
	): void {
		if (!quorumSet.hashKey) return;
		crawlState.quorumSets.set(quorumSet.hashKey, quorumSet);
		const owners = this.getQuorumSetHashOwners(quorumSet.hashKey, crawlState);

		owners.forEach((owner) => {
			const peer = crawlState.peerNodes.get(owner);
			if (peer) peer.quorumSet = quorumSet;
		});
		this.clearRequestQuorumSet(sender, crawlState);
	}

	public connectedToPeerNode(peerNode: PeerNode, crawlState: CrawlState): void {
		if (peerNode.quorumSetHash && !peerNode.quorumSet) {
			this.logger.info(
				{ hash: peerNode.quorumSetHash, pk: peerNode.publicKey },
				'Priority request'
			);
			crawlState.quorumSetState.quorumSetRequestHashesInProgress.delete(
				peerNode.quorumSetHash
			);
			const runningQuorumSetRequest =
				crawlState.quorumSetState.quorumSetRequests.get(peerNode.publicKey);
			if (runningQuorumSetRequest) {
				clearTimeout(runningQuorumSetRequest.timeout);
				crawlState.quorumSetState.quorumSetRequests.delete(peerNode.publicKey);
			}
			this.requestQuorumSet(peerNode.quorumSetHash, crawlState);
		}
		this.processUnknownQuorumSetHashes(crawlState);
	}

	public peerNodeDisconnected(
		publicKey: PublicKey,
		crawlState: CrawlState
	): void {
		const hash = this.clearRequestQuorumSet(publicKey, crawlState);
		if (hash) this.requestQuorumSet(hash, crawlState);
	}

	public peerNodeDoesNotHaveQuorumSet(
		publicKey: PublicKey,
		crawlState: CrawlState
	): void {
		//todo: dont have sends the quorumSetHash in the request hash field
		const hash = this.clearRequestQuorumSet(publicKey, crawlState);
		if (hash) this.requestQuorumSet(hash, crawlState);
	}

	protected requestQuorumSet(
		quorumSetHash: string,
		crawlState: CrawlState
	): void {
		if (crawlState.quorumSets.has(quorumSetHash)) return;

		if (
			crawlState.quorumSetState.quorumSetRequestHashesInProgress.has(
				quorumSetHash
			)
		) {
			this.logger.debug({ hash: quorumSetHash }, 'Request already in progress');
			return;
		}

		this.logger.debug({ hash: quorumSetHash }, 'Requesting quorumSet');
		const alreadyRequestedToResult =
			crawlState.quorumSetState.quorumSetRequestedTo.get(quorumSetHash);
		const alreadyRequestedTo: Set<string> = alreadyRequestedToResult
			? alreadyRequestedToResult
			: new Set();
		crawlState.quorumSetState.quorumSetRequestedTo.set(
			quorumSetHash,
			alreadyRequestedTo
		);

		const owners = this.getQuorumSetHashOwners(quorumSetHash, crawlState);
		const quorumSetMessage = xdr.StellarMessage.getScpQuorumset(
			Buffer.from(quorumSetHash, 'base64')
		);

		const sendRequest = (to: PublicKey) => {
			const connection = crawlState.openConnections.get(to);
			if (!connection || !connection.remotePublicKey) return;
			alreadyRequestedTo.add(connection.remotePublicKey);
			crawlState.quorumSetState.quorumSetRequestHashesInProgress.add(
				quorumSetHash
			);
			this.logger.info(
				{ hash: quorumSetHash },
				'Requesting quorumSet from ' + to
			);

			connection.sendStellarMessage(quorumSetMessage);
			crawlState.quorumSetState.quorumSetRequests.set(to, {
				timeout: setTimeout(() => {
					this.logger.info(
						{ pk: to, hash: quorumSetHash },
						'Request timeout reached'
					);
					crawlState.quorumSetState.quorumSetRequests.delete(to);
					crawlState.quorumSetState.quorumSetRequestHashesInProgress.delete(
						quorumSetHash
					);
					this.requestQuorumSet(quorumSetHash, crawlState);
				}, 2000),
				hash: quorumSetHash
			});
		};

		//first try the owners of the hashes
		const notYetRequestedOwnerWithActiveConnection = Array.from(owners.keys())
			.filter((owner) => !alreadyRequestedTo.has(owner))
			.find((owner) => crawlState.openConnections.has(owner));
		if (notYetRequestedOwnerWithActiveConnection) {
			sendRequest(notYetRequestedOwnerWithActiveConnection);
			return;
		}

		//try other open connections
		const notYetRequestedNonOwnerActiveConnection = Array.from(
			crawlState.openConnections.keys()
		).find((publicKey) => !alreadyRequestedTo.has(publicKey));

		if (notYetRequestedNonOwnerActiveConnection) {
			sendRequest(notYetRequestedNonOwnerActiveConnection);
			return;
		}

		this.logger.warn(
			{ hash: quorumSetHash },
			'No active connections to request quorumSet from'
		);
		crawlState.quorumSetState.unknownQuorumSets.add(quorumSetHash);
	}

	protected processUnknownQuorumSetHashes(crawlState: CrawlState): void {
		crawlState.quorumSetState.unknownQuorumSets.forEach((qSetHash) => {
			this.requestQuorumSet(qSetHash, crawlState);
		});
	}

	protected getQuorumSetHashOwners(
		quorumSetHash: QuorumSetHash,
		crawlState: CrawlState
	): Set<string> {
		let quorumSetHashOwners =
			crawlState.quorumSetState.quorumSetOwners.get(quorumSetHash);
		if (!quorumSetHashOwners) {
			quorumSetHashOwners = new Set();
			crawlState.quorumSetState.quorumSetOwners.set(
				quorumSetHash,
				quorumSetHashOwners
			);
		}

		return quorumSetHashOwners;
	}

	protected getQuorumSetHash(
		scpStatement: xdr.ScpStatement
	): Result<QuorumSetHash, Error> {
		try {
			let quorumSetHash: QuorumSetHash | undefined;
			switch (scpStatement.pledges().switch()) {
				case xdr.ScpStatementType.scpStExternalize():
					quorumSetHash = scpStatement
						.pledges()
						.externalize()
						.commitQuorumSetHash()
						.toString('base64');
					break;
				case xdr.ScpStatementType.scpStConfirm():
					quorumSetHash = scpStatement
						.pledges()
						.confirm()
						.quorumSetHash()
						.toString('base64');
					break;
				case xdr.ScpStatementType.scpStPrepare():
					quorumSetHash = scpStatement
						.pledges()
						.prepare()
						.quorumSetHash()
						.toString('base64');
					break;
				case xdr.ScpStatementType.scpStNominate():
					quorumSetHash = scpStatement
						.pledges()
						.nominate()
						.quorumSetHash()
						.toString('base64');
					break;
			}

			if (quorumSetHash) return ok(quorumSetHash);
			else return err(new Error('Cannot parse quorumSet'));
		} catch (e) {
			if (e instanceof Error) return err(e);
			else return err(new Error('Cannot parse quorumSet'));
		}
	}

	protected clearRequestQuorumSet(
		publicKey: PublicKey,
		crawlState: CrawlState
	): QuorumSetHash {
		const quorumSetRequest =
			crawlState.quorumSetState.quorumSetRequests.get(publicKey);
		if (!quorumSetRequest) return '';
		clearTimeout(quorumSetRequest.timeout);
		crawlState.quorumSetState.quorumSetRequests.delete(publicKey);
		crawlState.quorumSetState.quorumSetRequestHashesInProgress.delete(
			quorumSetRequest.hash
		);

		return quorumSetRequest.hash;
	}
}
