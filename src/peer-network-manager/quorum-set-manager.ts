import { PublicKey, QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import * as P from 'pino';
import { xdr } from '@stellar/stellar-base';
import { PeerNode } from '../peer-node';
import { CrawlState } from '../crawl-state';
import { err, ok, Result } from 'neverthrow';
import { truncate } from '../utilities/truncate';
import { ConnectionManager } from './connection-manager';

type QuorumSetHash = string;

/**
 * Fetches quorumSets in a sequential way from connected nodes.
 * Makes sure every peerNode that sent a scp message with a hash, gets the correct quorumSet.
 */
export class QuorumSetManager {
	static MS_TO_WAIT_FOR_REPLY = 1500;

	constructor(
		private connectionManager: ConnectionManager,
		private logger: P.Logger
	) {}

	public onNodeDisconnected(
		publicKey: PublicKey,
		crawlState: CrawlState
	): void {
		if (!crawlState.quorumSetState.quorumSetRequests.has(publicKey)) return;

		this.clearQuorumSetRequest(publicKey, crawlState);
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
				'Detected quorumSetHash'
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
		quorumSetHash: QuorumSetHash,
		quorumSet: QuorumSet,
		sender: PublicKey,
		crawlState: CrawlState
	): void {
		crawlState.quorumSets.set(quorumSetHash, quorumSet);
		const owners = this.getQuorumSetHashOwners(quorumSetHash, crawlState);

		owners.forEach((owner) => {
			const peer = crawlState.peerNodes.get(owner);
			if (peer) peer.quorumSet = quorumSet;
		});

		this.clearQuorumSetRequest(sender, crawlState);
	}

	public peerNodeDoesNotHaveQuorumSet(
		peerPublicKey: PublicKey,
		quorumSetHash: QuorumSetHash,
		crawlState: CrawlState
	): void {
		const request =
			crawlState.quorumSetState.quorumSetRequests.get(peerPublicKey);
		if (!request) return;
		if (request.hash !== quorumSetHash) return;

		this.clearQuorumSetRequest(peerPublicKey, crawlState);
		this.requestQuorumSet(quorumSetHash, crawlState);
	}

	protected requestQuorumSet(
		quorumSetHash: QuorumSetHash,
		crawlState: CrawlState
	): void {
		if (crawlState.quorumSets.has(quorumSetHash)) return;

		if (
			crawlState.quorumSetState.quorumSetHashesInProgress.has(quorumSetHash)
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

		const sendRequest = (to: string) => {
			const connection = this.connectionManager.getActiveConnection(to); //todo: need more separation
			if (!connection) {
				this.logger.warn(
					{ hash: quorumSetHash, address: to },
					'No active connection to request quorumSet from'
				);
				return;
			}
			alreadyRequestedTo.add(to);
			this.logger.info(
				{ hash: quorumSetHash },
				'Requesting quorumSet from ' + to
			);

			connection.sendStellarMessage(quorumSetMessage);
			crawlState.quorumSetState.quorumSetHashesInProgress.add(quorumSetHash);
			crawlState.quorumSetState.quorumSetRequests.set(to, {
				hash: quorumSetHash,
				timeout: setTimeout(() => {
					this.logger.info(
						{ pk: truncate(to), hash: quorumSetHash },
						'Request timeout reached'
					);
					crawlState.quorumSetState.quorumSetRequests.delete(to);
					crawlState.quorumSetState.quorumSetHashesInProgress.delete(
						quorumSetHash
					);

					this.requestQuorumSet(quorumSetHash, crawlState);
				}, QuorumSetManager.MS_TO_WAIT_FOR_REPLY)
			});
		};

		//first try the owners of the hashes
		const notYetRequestedOwnerWithActiveConnection = (
			Array.from(owners.keys())
				.map((owner) => crawlState.peerNodes.get(owner))
				.filter((owner) => owner !== undefined) as PeerNode[]
		)
			.filter((owner) => !alreadyRequestedTo.has(owner.key))
			.find((owner) => this.connectionManager.hasActiveConnectionTo(owner.key));
		if (notYetRequestedOwnerWithActiveConnection) {
			sendRequest(notYetRequestedOwnerWithActiveConnection.key);
			return;
		}

		//try other open connections
		const notYetRequestedNonOwnerActiveConnection = this.connectionManager
			.getActiveConnectionAddresses()
			.find((address) => !alreadyRequestedTo.has(address));

		if (notYetRequestedNonOwnerActiveConnection) {
			sendRequest(notYetRequestedNonOwnerActiveConnection);
			return;
		}

		this.logger.warn(
			{ hash: quorumSetHash },
			'No active connections to request quorumSet from'
		);
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

	protected clearQuorumSetRequest(
		peerPublicKey: PublicKey,
		crawlState: CrawlState
	): void {
		const result =
			crawlState.quorumSetState.quorumSetRequests.get(peerPublicKey);
		if (!result) return;
		clearTimeout(result.timeout);
		crawlState.quorumSetState.quorumSetRequests.delete(peerPublicKey);
		crawlState.quorumSetState.quorumSetHashesInProgress.delete(result.hash);
	}
}
