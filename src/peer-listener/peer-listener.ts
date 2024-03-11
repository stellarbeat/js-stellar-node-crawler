import { P } from 'pino';
import { CrawlProcessState, CrawlState } from '../crawl-state';
import { truncate } from '../utilities/truncate';
import {
	ConnectedPayload,
	ConnectionManager,
	DataPayload
} from '../connection-manager';
import { QuorumSetManager } from './quorum-set-manager';
import { StellarMessageHandler } from './stellar-message-handlers/stellar-message-handler';
import { PeerNodeCollection } from '../peer-node-collection';
import { ok, Result } from 'neverthrow';
import { NodeAddress } from '../node-address';
import { Ledger } from '../crawler';

export class PeerListener {
	private static readonly NETWORK_CONSENSUS_TIMEOUT = 90000; //90 seconds before we declare the network stuck.
	private static readonly PEER_STRAGGLE_TIMEOUT = 10000; //if the network has externalized, you get 10 seconds to catch up.

	private networkConsensusTimer: NodeJS.Timeout | null = null;
	private networkHalted = false;
	private stopping = false;

	constructor(
		private connectionManager: ConnectionManager,
		private quorumSetManager: QuorumSetManager,
		private stellarMessageHandler: StellarMessageHandler,
		private logger: P.Logger
	) {}

	public startConsensusTracking() {
		this.networkHalted = false;
		this.stopping = false;
		this.setNetworkConsensusTimer();
	}

	public stop() {
		if (this.networkConsensusTimer) clearTimeout(this.networkConsensusTimer);
		this.stopping = true;
		if (this.connectionManager.getActiveConnectionAddresses().length === 0)
			return;
		setTimeout(() => {
			this.connectionManager.shutdown(); //give straggling top tier nodes a chance and then shut down.
		}, PeerListener.PEER_STRAGGLE_TIMEOUT);
	}

	private setNetworkConsensusTimer() {
		if (this.networkConsensusTimer) clearTimeout(this.networkConsensusTimer);
		this.networkConsensusTimer = setTimeout(() => {
			this.logger.info('Network consensus timeout');
			this.onNetworkHalted();
		}, PeerListener.NETWORK_CONSENSUS_TIMEOUT);
	}

	private onNetworkHalted() {
		this.networkHalted = true;
		this.connectionManager.getActiveConnectionAddresses().forEach((address) => {
			this.connectionManager.disconnectByAddress(address);
		}); //disconnect all peers
	}

	private onLedgerCloseConfirmation(crawlState: CrawlState, ledger: Ledger) {
		if (this.networkHalted) return; // we report that the network was halted
		crawlState.updateLatestConfirmedClosedLedger(ledger);
		const activePeers = this.connectionManager
			.getActiveConnectionAddresses()
			.filter((address) => {
				return !crawlState.topTierAddresses.has(address);
			});
		if (activePeers.length === 0) return; //no potential stragglers
		setTimeout(() => {
			this.logger.debug({ activePeers }, 'Straggler timeout hit');
			activePeers.forEach((address) => {
				this.connectionManager.disconnectByAddress(address);
			});
		}, PeerListener.PEER_STRAGGLE_TIMEOUT);
		this.setNetworkConsensusTimer();
	}

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

		if (this.networkHalted) {
			//try to gather minimal data from the peer and disconnect
			setTimeout(() => {
				this.disconnect(`${data.ip}:${data.port}`);
			}, PeerListener.PEER_STRAGGLE_TIMEOUT);
		}
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
		} //if peer.key differs from remoteAddress,then this is a connection to an ip that reuses a publicKey. These connections are ignored, and we should make sure we don't interfere with a possible connection to the other ip that uses the public key.
	}

	public onData(
		//todo: refactor out crawlState
		data: DataPayload,
		crawlState: CrawlState
	): Result<
		{
			peers: NodeAddress[];
		},
		Error
	> {
		const result = this.stellarMessageHandler.handleStellarMessage(
			data.publicKey,
			data.stellarMessageWork.stellarMessage,
			crawlState
		);

		data.stellarMessageWork.done();

		if (result.isErr()) {
			this.logger.info({ peer: data.publicKey }, result.error.message);
			this.connectionManager.disconnectByAddress(data.address, result.error);
			return result;
		}

		if (result.value.closedLedger) {
			this.onLedgerCloseConfirmation(crawlState, result.value.closedLedger);
		}

		return ok({ peers: result.value.peers });
	}

	private disconnect(address: string, error?: Error) {
		this.connectionManager.disconnectByAddress(address, error);
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
