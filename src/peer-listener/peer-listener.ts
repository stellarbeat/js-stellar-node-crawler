import { P } from 'pino';
import { PeerListenTimeoutManager } from './peer-listen-timeout-manager';
import { CrawlProcessState, CrawlState } from '../crawl-state';
import { truncate } from '../utilities/truncate';
import {
	ConnectedPayload,
	ConnectionManager,
	DataPayload
} from '../connection-manager';
import { PeerNode } from '../peer-node';
import { QuorumSetManager } from './quorum-set-manager';
import { StellarMessageHandler } from './stellar-message-handlers/stellar-message-handler';
import { PeerNodeCollection } from '../peer-node-collection';

export class PeerListener {
	constructor(
		private connectionManager: ConnectionManager,
		private quorumSetManager: QuorumSetManager,
		private stellarMessageHandler: StellarMessageHandler,
		private peerListenTimeoutManager: PeerListenTimeoutManager,
		private logger: P.Logger
	) {}

	public onConnected(
		data: ConnectedPayload,
		peerNodes: PeerNodeCollection,
		isTopTierNode: boolean,
		getCrawlProcessState: () => CrawlProcessState,
		localTime: Date
	): undefined | Error {
		this.logIfTopTierConnected(isTopTierNode, data);
		const peerNodeOrError = this.addPeerNode(peerNodes, data, localTime);

		if (peerNodeOrError instanceof Error) {
			this.disconnect(`${data.ip}:${data.port}`, peerNodeOrError);
			return peerNodeOrError;
		}

		this.startListenTimeout(
			peerNodeOrError,
			isTopTierNode,
			getCrawlProcessState
		);
	}

	public onConnectionClose(
		address: string,
		publicKey: string,
		crawlState: CrawlState,
		localTime: Date
	): void {
		this.logIfTopTierDisconnect(crawlState, publicKey, address);
		this.quorumSetManager.onNodeDisconnected(publicKey, crawlState);
		const peer = crawlState.peerNodes.get(publicKey);
		if (peer && peer.key === address) {
			peer.disconnected = true;
			peer.disconnectionTime = localTime;
			this.peerListenTimeoutManager.stopTimer(peer);
		} //if peer.key differs from remoteAddress,then this is a connection to an ip that reuses a publicKey. These connections are ignored, and we should make sure we don't interfere with a possible connection to the other ip that uses the public key.
	}

	public onData(data: DataPayload, crawlState: CrawlState): void {
		const result = this.stellarMessageHandler.handleStellarMessage(
			data.publicKey,
			data.stellarMessageWork.stellarMessage,
			crawlState
		);

		data.stellarMessageWork.done();

		if (result.isErr()) {
			this.logger.info({ peer: data.publicKey }, result.error.message);
			this.connectionManager.disconnectByAddress(data.address, result.error);
		}
	}

	private startListenTimeout(
		peerNodeOrError: PeerNode,
		isTopTierNode: boolean,
		getCrawlProcessState: () => CrawlProcessState
	) {
		this.peerListenTimeoutManager.startTimer(
			peerNodeOrError,
			0,
			isTopTierNode,
			() => this.connectionManager.disconnectByAddress(peerNodeOrError.key),
			getCrawlProcessState
		);
	}

	private disconnect(address: string, peerNodeOrError: Error) {
		this.connectionManager.disconnectByAddress(address, peerNodeOrError);
	}

	private addPeerNode(peerNodes: any, data: any, localTime: Date) {
		return peerNodes.addSuccessfullyConnected(
			data.publicKey,
			data.ip,
			data.port,
			data.nodeInfo,
			localTime
		);
	}

	private logIfTopTierConnected(isTopTierNode: boolean, data: any) {
		if (isTopTierNode) {
			this.logger.debug(
				{ pk: truncate(data.publicKey) },
				'Top tier node connected'
			);
		}
	}

	private logIfTopTierDisconnect(
		crawlState: CrawlState,
		publicKey: string,
		nodeAddress: string
	) {
		if (crawlState.topTierNodes.has(publicKey)) {
			this.logger.debug(
				{ pk: truncate(publicKey), address: nodeAddress },
				'Top tier node disconnected'
			);
		}
	}
}
