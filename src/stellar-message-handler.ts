import {
	Connection,
	getIpFromPeerAddress,
	getQuorumSetFromMessage
} from '@stellarbeat/js-stellar-node-connector';
import { hash, xdr } from '@stellar/stellar-base';
import { CrawlState } from './crawl-state';
import { P } from 'pino';
import { StellarMessageWork } from '@stellarbeat/js-stellar-node-connector/lib/connection/connection';
import { EventEmitter } from 'events';
import { ScpManager } from './scp-manager';
import { NodeAddress } from './crawler';
import { truncate } from './truncate';
import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { QuorumSetManager } from './quorum-set-manager';

export class StellarMessageHandler extends EventEmitter {
	constructor(
		private scpManager: ScpManager,
		private quorumSetManager: QuorumSetManager,
		private logger: P.Logger
	) {
		super();
	}

	handleStellarMessage(
		connection: Connection,
		stellarMessageWork: StellarMessageWork,
		crawlState: CrawlState
	): void {
		const stellarMessage = stellarMessageWork.stellarMessage;
		switch (stellarMessage.switch()) {
			case xdr.MessageType.scpMessage():
				this.handleScpMessage(
					connection,
					stellarMessage.envelope(),
					crawlState
				);
				break;
			case xdr.MessageType.peers():
				this.handlePeersMessage(connection, stellarMessage.peers(), crawlState);
				break;
			case xdr.MessageType.scpQuorumset():
				this.handleScpQuorumSetMessage(
					connection,
					stellarMessage.qSet(),
					crawlState
				);
				break;
			case xdr.MessageType.dontHave():
				this.handleDontHaveMessage(
					connection,
					stellarMessage.dontHave(),
					crawlState
				);
				break;
			case xdr.MessageType.errorMsg():
				this.handleErrorMsg(connection, stellarMessage.error(), crawlState);
				break;
			default:
				this.logger.debug(
					{ type: stellarMessage.switch().name },
					'Unhandled Stellar message type'
				);
				break;
		}
		stellarMessageWork.done();
	}

	private handleScpMessage(
		connection: Connection,
		envelope: xdr.ScpEnvelope,
		crawlState: CrawlState
	): void {
		const result = this.scpManager.processScpEnvelope(envelope, crawlState);
		if (result.isErr()) {
			this.logger.error(
				{ peer: connection.remoteAddress },
				result.error.message
			);
			this.emit('disconnect', connection);
		}
	}

	private handlePeersMessage(
		connection: Connection,
		peers: xdr.PeerAddress[],
		crawlState: CrawlState
	): void {
		const peerAddresses: Array<NodeAddress> = [];
		peers.forEach((peer) => {
			const ipResult = getIpFromPeerAddress(peer);
			if (ipResult.isOk()) peerAddresses.push([ipResult.value, peer.port()]);
		});

		this.logger.debug(
			{ peer: connection.remoteAddress },
			peerAddresses.length + ' peers received'
		);

		this.emit('peerAddresses', {
			from: connection.remotePublicKey,
			crawlState: crawlState,
			peerAddresses: peerAddresses
		});
	}

	private handleScpQuorumSetMessage(
		connection: Connection,
		quorumSetMessage: xdr.ScpQuorumSet,
		crawlState: CrawlState
	): void {
		const quorumSetHash = hash(quorumSetMessage.toXDR()).toString('base64');
		const quorumSetResult = getQuorumSetFromMessage(quorumSetMessage);
		if (quorumSetResult.isErr()) {
			this.logger.error(
				{ peer: connection.remoteAddress },
				'Invalid quorum set received'
			);
			this.emit('disconnect', connection);
			return;
		}
		this.logger.info(
			{
				pk: truncate(connection.remotePublicKey),
				hash: quorumSetHash
			},
			'QuorumSet received'
		);
		if (connection.remotePublicKey)
			this.quorumSetManager.processQuorumSet(
				quorumSetHash,
				QuorumSet.fromBaseQuorumSet(quorumSetResult.value),
				connection.remotePublicKey,
				crawlState
			);
	}

	private handleDontHaveMessage(
		connection: Connection,
		dontHave: xdr.DontHave,
		crawlState: CrawlState
	): void {
		this.logger.info(
			{
				pk: truncate(connection.remotePublicKey),
				type: dontHave.type().name
			},
			"Don't have"
		);
		if (dontHave.type().value === xdr.MessageType.getScpQuorumset().value) {
			this.logger.info(
				{
					pk: truncate(connection.remotePublicKey),
					hash: dontHave.reqHash().toString('base64')
				},
				"Don't have"
			);
			if (connection.remotePublicKey) {
				this.quorumSetManager.peerNodeDoesNotHaveQuorumSet(
					connection.remotePublicKey,
					dontHave.reqHash().toString('base64'),
					crawlState
				);
			}
		}
	}

	private handleErrorMsg(
		connection: Connection,
		error: xdr.Error,
		crawlState: CrawlState
	): void {
		switch (error.code()) {
			case xdr.ErrorCode.errLoad():
				this.onLoadTooHighReceived(connection, crawlState);
				break;
			default:
				this.logger.info(
					{
						pk: truncate(connection.remotePublicKey),
						peer: connection.remoteIp + ':' + connection.remotePort,
						error: error.code().name
					},
					error.msg().toString()
				);
				break;
		}

		this.emit('disconnect', connection);
	}

	private onLoadTooHighReceived(
		connection: Connection,
		crawlState: CrawlState
	): void {
		this.logger.debug(
			{ peer: connection.remoteAddress },
			'Load too high message received'
		);
		if (connection.remotePublicKey) {
			const node = crawlState.peerNodes.get(connection.remotePublicKey);
			if (node) {
				node.overLoaded = true;
			}
		}
	}
}
