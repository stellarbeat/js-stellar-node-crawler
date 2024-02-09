import {
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
import { err, ok, Result } from 'neverthrow';
import { PeerNode } from './peer-node';

type PublicKey = string;

export class StellarMessageHandler extends EventEmitter {
	constructor(
		private scpManager: ScpManager,
		private quorumSetManager: QuorumSetManager,
		private logger: P.Logger
	) {
		super();
	}

	handleStellarMessage(
		sender: PeerNode,
		stellarMessageWork: StellarMessageWork,
		crawlState: CrawlState
	): Result<void, Error> {
		const stellarMessage = stellarMessageWork.stellarMessage;
		const result = this.handleStellarMessageInternal(
			stellarMessage,
			sender,
			crawlState
		);
		stellarMessageWork.done();
		return result;
	}

	private handleStellarMessageInternal(
		stellarMessage: xdr.StellarMessage,
		sender: PeerNode,
		crawlState: CrawlState
	): Result<void, Error> {
		switch (stellarMessage.switch()) {
			case xdr.MessageType.scpMessage():
				return this.scpManager.processScpEnvelope(
					stellarMessage.envelope(),
					crawlState
				);
			case xdr.MessageType.peers():
				return this.handlePeersMessage(
					sender,
					stellarMessage.peers(),
					crawlState
				);
			case xdr.MessageType.scpQuorumset():
				return this.handleScpQuorumSetMessage(
					sender.publicKey,
					stellarMessage.qSet(),
					crawlState
				);
			case xdr.MessageType.dontHave():
				return this.handleDontHaveMessage(
					sender.publicKey,
					stellarMessage.dontHave(),
					crawlState
				);
			case xdr.MessageType.errorMsg():
				return this.handleErrorMsg(
					sender.publicKey,
					stellarMessage.error(),
					crawlState
				);
			default:
				this.logger.debug(
					{ type: stellarMessage.switch().name },
					'Unhandled Stellar message type'
				);
				return ok(undefined);
		}
	}

	private handlePeersMessage(
		sender: PeerNode,
		peers: xdr.PeerAddress[],
		crawlState: CrawlState
	): Result<void, Error> {
		const peerAddresses: Array<NodeAddress> = [];
		peers.forEach((peer) => {
			const ipResult = getIpFromPeerAddress(peer);
			if (ipResult.isOk()) peerAddresses.push([ipResult.value, peer.port()]);
		});

		sender.suppliedPeerList = true;

		this.logger.debug(
			{ peer: sender.publicKey },
			peerAddresses.length + ' peers received'
		);

		this.emit('peerAddresses', {
			crawlState: crawlState,
			peerAddresses: peerAddresses
		});

		return ok(undefined);
	}

	private handleScpQuorumSetMessage(
		sender: PublicKey,
		quorumSetMessage: xdr.ScpQuorumSet,
		crawlState: CrawlState
	): Result<void, Error> {
		const quorumSetHash = hash(quorumSetMessage.toXDR()).toString('base64');
		const quorumSetResult = getQuorumSetFromMessage(quorumSetMessage);
		if (quorumSetResult.isErr()) {
			return err(quorumSetResult.error);
		}
		this.logger.info(
			{
				pk: truncate(sender),
				hash: quorumSetHash
			},
			'QuorumSet received'
		);
		this.quorumSetManager.processQuorumSet(
			quorumSetHash,
			QuorumSet.fromBaseQuorumSet(quorumSetResult.value),
			sender,
			crawlState
		);

		return ok(undefined);
	}

	private handleDontHaveMessage(
		sender: PublicKey,
		dontHave: xdr.DontHave,
		crawlState: CrawlState
	): Result<void, Error> {
		this.logger.info(
			{
				pk: truncate(sender),
				type: dontHave.type().name
			},
			"Don't have"
		);
		if (dontHave.type().value === xdr.MessageType.getScpQuorumset().value) {
			this.logger.info(
				{
					pk: truncate(sender),
					hash: dontHave.reqHash().toString('base64')
				},
				"Don't have"
			);
			this.quorumSetManager.peerNodeDoesNotHaveQuorumSet(
				sender,
				dontHave.reqHash().toString('base64'),
				crawlState
			);
		}

		return ok(undefined);
	}

	private handleErrorMsg(
		sender: PublicKey,
		error: xdr.Error,
		crawlState: CrawlState
	): Result<void, Error> {
		switch (error.code()) {
			case xdr.ErrorCode.errLoad():
				return this.onLoadTooHighReceived(sender, crawlState);
			default:
				this.logger.info(
					{
						pk: truncate(sender),
						error: error.code().name
					},
					error.msg().toString()
				);
				return ok(undefined);
		}
	}

	private onLoadTooHighReceived(
		sender: PublicKey,
		crawlState: CrawlState
	): Result<void, Error> {
		this.logger.debug({ peer: sender }, 'Load too high message received');
		const node = crawlState.peerNodes.get(sender);
		if (node) {
			node.overLoaded = true;
		}

		return ok(undefined);
	}
}
