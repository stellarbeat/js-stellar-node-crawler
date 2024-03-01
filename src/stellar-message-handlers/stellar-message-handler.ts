import {
	getIpFromPeerAddress,
	getQuorumSetFromMessage
} from '@stellarbeat/js-stellar-node-connector';
import { hash, xdr } from '@stellar/stellar-base';
import { CrawlState } from '../crawl-state';
import { P } from 'pino';
import { EventEmitter } from 'events';
import { ScpEnvelopeHandler } from './scp-envelope/scp-envelope-handler';
import { truncate } from '../utilities/truncate';
import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { QuorumSetManager } from '../quorum-set-manager';
import { err, ok, Result } from 'neverthrow';
import { PeerNodeCollection } from '../peer-node-collection';
import { NodeAddress } from '../node-address';

export interface PeerAddressesReceivedEvent {
	peerAddresses: Array<NodeAddress>;
}

type PublicKey = string;

export class StellarMessageHandler extends EventEmitter {
	constructor(
		private scpEnvelopeHandler: ScpEnvelopeHandler,
		private quorumSetManager: QuorumSetManager,
		private logger: P.Logger
	) {
		super();
	}

	handleStellarMessage(
		sender: PublicKey,
		stellarMessage: xdr.StellarMessage,
		crawlState: CrawlState
	): Result<void, Error> {
		return this.handleStellarMessageInternal(
			stellarMessage,
			sender,
			crawlState
		);
	}

	private handleStellarMessageInternal(
		stellarMessage: xdr.StellarMessage,
		sender: PublicKey,
		crawlState: CrawlState
	): Result<void, Error> {
		switch (stellarMessage.switch()) {
			case xdr.MessageType.scpMessage():
				return this.scpEnvelopeHandler.handle(
					stellarMessage.envelope(),
					crawlState
				);
			case xdr.MessageType.peers():
				return this.handlePeersMessage(
					sender,
					stellarMessage.peers(),
					crawlState.peerNodes
				);
			case xdr.MessageType.scpQuorumset():
				return this.handleScpQuorumSetMessage(
					sender,
					stellarMessage.qSet(),
					crawlState
				);
			case xdr.MessageType.dontHave():
				return this.handleDontHaveMessage(
					sender,
					stellarMessage.dontHave(),
					crawlState
				);
			case xdr.MessageType.errorMsg():
				return this.handleErrorMsg(sender, stellarMessage.error(), crawlState);
			default:
				this.logger.debug(
					{ type: stellarMessage.switch().name },
					'Unhandled Stellar message type'
				);
				return ok(undefined);
		}
	}

	private handlePeersMessage(
		sender: PublicKey,
		peers: xdr.PeerAddress[],
		peerNodeCollection: PeerNodeCollection
	): Result<void, Error> {
		const peerAddresses: Array<NodeAddress> = [];
		peers.forEach((peer) => {
			const ipResult = getIpFromPeerAddress(peer);
			if (ipResult.isOk()) peerAddresses.push([ipResult.value, peer.port()]);
		});

		peerNodeCollection.setPeerSuppliedPeerList(sender, true);

		this.logger.debug(
			{ peer: sender },
			peerAddresses.length + ' peers received'
		);

		this.emit('peerAddressesReceived', {
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
		crawlState.peerNodes.setPeerOverloaded(sender, true);

		return ok(undefined);
	}
}
