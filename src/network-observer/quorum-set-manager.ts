import { PublicKey, QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import * as P from 'pino';
import { xdr } from '@stellar/stellar-base';
import { PeerNode } from '../peer-node';
import { err, ok, Result } from 'neverthrow';
import { truncate } from '../utilities/truncate';
import { ConnectionManager } from './connection-manager';
import { Observation } from './observation';

type QuorumSetHash = string;

/**
 * Fetches quorumSets in a sequential way from connected nodes.
 * Makes sure every peerNode that sent a scp message with a hash, gets the correct quorumSet.
 */
export class QuorumSetManager {
	constructor(
		private connectionManager: ConnectionManager,
		private quorumRequestTimeoutMS: number,
		private logger: P.Logger
	) {}

	public onNodeDisconnected(
		publicKey: PublicKey,
		observation: Observation
	): void {
		if (!observation.quorumSetState.quorumSetRequests.has(publicKey)) return;

		this.clearQuorumSetRequest(publicKey, observation);
	}

	public processQuorumSetHashFromStatement(
		peer: PeerNode,
		scpStatement: xdr.ScpStatement,
		observation: Observation
	): void {
		const quorumSetHashResult = this.getQuorumSetHash(scpStatement);
		if (quorumSetHashResult.isErr()) return;

		peer.quorumSetHash = quorumSetHashResult.value;
		if (
			!this.getQuorumSetHashOwners(peer.quorumSetHash, observation).has(
				peer.publicKey
			)
		) {
			this.logger.debug(
				{ pk: peer.publicKey, hash: peer.quorumSetHash },
				'Detected quorumSetHash'
			);
		}

		this.getQuorumSetHashOwners(peer.quorumSetHash, observation).add(
			peer.publicKey
		);

		if (observation.quorumSets.has(peer.quorumSetHash))
			peer.quorumSet = observation.quorumSets.get(peer.quorumSetHash);
		else {
			this.logger.debug(
				{ pk: peer.publicKey },
				'Unknown quorumSet for hash: ' + peer.quorumSetHash
			);
			this.requestQuorumSet(peer.quorumSetHash, observation);
		}
	}

	public processQuorumSet(
		quorumSetHash: QuorumSetHash,
		quorumSet: QuorumSet,
		sender: PublicKey,
		observation: Observation
	): void {
		observation.quorumSets.set(quorumSetHash, quorumSet);
		const owners = this.getQuorumSetHashOwners(quorumSetHash, observation);

		owners.forEach((owner) => {
			const peer = observation.peerNodes.get(owner);
			if (peer) peer.quorumSet = quorumSet;
		});

		this.clearQuorumSetRequest(sender, observation);
	}

	public peerNodeDoesNotHaveQuorumSet(
		peerPublicKey: PublicKey,
		quorumSetHash: QuorumSetHash,
		observation: Observation
	): void {
		const request =
			observation.quorumSetState.quorumSetRequests.get(peerPublicKey);
		if (!request) return;
		if (request.hash !== quorumSetHash) return;

		this.clearQuorumSetRequest(peerPublicKey, observation);
		this.requestQuorumSet(quorumSetHash, observation);
	}

	protected requestQuorumSet(
		quorumSetHash: QuorumSetHash,
		observation: Observation
	): void {
		if (observation.quorumSets.has(quorumSetHash)) return;

		if (
			observation.quorumSetState.quorumSetHashesInProgress.has(quorumSetHash)
		) {
			this.logger.debug({ hash: quorumSetHash }, 'Request already in progress');
			return;
		}

		this.logger.debug({ hash: quorumSetHash }, 'Requesting quorumSet');
		const alreadyRequestedToResult =
			observation.quorumSetState.quorumSetRequestedTo.get(quorumSetHash);
		const alreadyRequestedTo: Set<string> = alreadyRequestedToResult
			? alreadyRequestedToResult
			: new Set();
		observation.quorumSetState.quorumSetRequestedTo.set(
			quorumSetHash,
			alreadyRequestedTo
		);

		const owners = this.getQuorumSetHashOwners(quorumSetHash, observation);
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
			observation.quorumSetState.quorumSetHashesInProgress.add(quorumSetHash);
			observation.quorumSetState.quorumSetRequests.set(to, {
				hash: quorumSetHash,
				timeout: setTimeout(() => {
					this.logger.info(
						{ pk: truncate(to), hash: quorumSetHash },
						'Request timeout reached'
					);
					observation.quorumSetState.quorumSetRequests.delete(to);
					observation.quorumSetState.quorumSetHashesInProgress.delete(
						quorumSetHash
					);

					this.requestQuorumSet(quorumSetHash, observation);
				}, this.quorumRequestTimeoutMS)
			});
		};

		//first try the owners of the hashes
		const notYetRequestedOwnerWithActiveConnection = (
			Array.from(owners.keys())
				.map((owner) => observation.peerNodes.get(owner))
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
		observation: Observation
	): Set<string> {
		let quorumSetHashOwners =
			observation.quorumSetState.quorumSetOwners.get(quorumSetHash);
		if (!quorumSetHashOwners) {
			quorumSetHashOwners = new Set();
			observation.quorumSetState.quorumSetOwners.set(
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
		observation: Observation
	): void {
		const result =
			observation.quorumSetState.quorumSetRequests.get(peerPublicKey);
		if (!result) return;
		clearTimeout(result.timeout);
		observation.quorumSetState.quorumSetRequests.delete(peerPublicKey);
		observation.quorumSetState.quorumSetHashesInProgress.delete(result.hash);
	}
}
