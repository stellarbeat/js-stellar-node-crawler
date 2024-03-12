import { P } from 'pino';
import { CrawlState } from '../crawl-state';
import { truncate } from '../utilities/truncate';
import {
	ClosePayload,
	ConnectedPayload,
	ConnectionManager,
	DataPayload
} from '../connection-manager';
import { QuorumSetManager } from './quorum-set-manager';
import { StellarMessageHandler } from './stellar-message-handlers/stellar-message-handler';
import { NodeAddress } from '../node-address';
import { Ledger } from '../crawler';
import { EventEmitter } from 'events';

export class PeerListener extends EventEmitter {
	private static readonly NETWORK_CONSENSUS_TIMEOUT = 90000; //90 seconds before we declare the network stuck.
	private static readonly PEER_STRAGGLE_TIMEOUT = 10000; //if the network has externalized, you get 10 seconds to catch up.

	private networkConsensusTimer: NodeJS.Timeout | null = null;
	private networkHalted = false;
	private stopping = false;
	private topTierAddresses: Set<string> = new Set();

	private _crawlState?: CrawlState; //todo: refactor out crawlState

	constructor(
		private connectionManager: ConnectionManager,
		private quorumSetManager: QuorumSetManager,
		private stellarMessageHandler: StellarMessageHandler,
		private logger: P.Logger
	) {
		super();
		this.connectionManager.on('connected', (data: ConnectedPayload) => {
			this.onConnected(data);
		});
		this.connectionManager.on('close', (data: ClosePayload) => {
			this.onConnectionClose(data);
		});
		this.connectionManager.on('data', (data: DataPayload) => {
			this.onData(data);
		});
	}

	get crawlState(): CrawlState {
		if (!this._crawlState) {
			throw new Error('CrawlState not set');
		}
		return this._crawlState;
	}

	public startConsensusTracking() {
		this.setNetworkConsensusTimer();
	}

	public async start(
		topTierNodes: NodeAddress[],
		crawlState: CrawlState
	): Promise<number> {
		return new Promise<number>((resolve, reject) => {
			this.networkHalted = false;
			this.stopping = false;
			this._crawlState = crawlState;
			topTierNodes.forEach((address) => {
				this.connectionManager.connectToNode(address[0], address[1]);
				this.topTierAddresses.add(`${address[0]}:${address[1]}`);
			});

			setTimeout(() => {
				resolve(this.connectionManager.getNumberOfActiveConnections());
			}, 10000);
		});
	}

	getActiveTopTierConnections() {
		return this.connectionManager
			.getActiveConnectionAddresses()
			.filter((address) => {
				return this.topTierAddresses.has(address);
			});
	}

	public connectToNode(ip: string, port: number) {
		this.connectionManager.connectToNode(ip, port);
	}

	public async stop() {
		return new Promise<void>((resolve) => {
			if (this.networkConsensusTimer) clearTimeout(this.networkConsensusTimer);
			this.stopping = true;
			if (this.connectionManager.getActiveConnectionAddresses().length === 0) {
				resolve();
				return;
			}

			setTimeout(() => {
				this.connectionManager.shutdown(); //give straggling top tier nodes a chance and then shut down.
				resolve();
			}, PeerListener.PEER_STRAGGLE_TIMEOUT);
		});
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

	private onConnected(data: ConnectedPayload): undefined | Error {
		this.logIfTopTierConnected(data);
		const peerNodeOrError = this.addPeerNode(data, new Date());

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

	private onConnectionClose(data: ClosePayload): void {
		this.logIfTopTierDisconnect(data);
		if (data.publicKey) {
			this.quorumSetManager.onNodeDisconnected(data.publicKey, this.crawlState);
			const peer = this.crawlState.peerNodes.get(data.publicKey);
			if (peer && peer.key === data.address) {
				peer.disconnected = true;
				peer.disconnectionTime = new Date();
			} //if peer.key differs from remoteAddress,then this is a connection to an ip that reuses a publicKey. These connections are ignored, and we should make sure we don't interfere with a possible connection to the other ip that uses the public key.
		}
		this.emit('disconnect', data);
	}

	private onData(data: DataPayload): void {
		const result = this.stellarMessageHandler.handleStellarMessage(
			data.publicKey,
			data.stellarMessageWork.stellarMessage,
			this.crawlState
		);

		data.stellarMessageWork.done();

		if (result.isErr()) {
			this.logger.info({ peer: data.publicKey }, result.error.message);
			this.connectionManager.disconnectByAddress(data.address, result.error);
			return;
		}

		if (result.value.closedLedger) {
			this.onLedgerCloseConfirmation(
				this.crawlState,
				result.value.closedLedger
			);
		}

		if (result.value.peers.length > 0) this.emit('peers', result.value.peers);
	}

	private disconnect(address: string, error?: Error) {
		this.connectionManager.disconnectByAddress(address, error);
	}

	private addPeerNode(data: ConnectedPayload, localTime: Date) {
		return this.crawlState.peerNodes.addSuccessfullyConnected(
			data.publicKey,
			data.ip,
			data.port,
			data.nodeInfo,
			localTime
		);
	}

	private logIfTopTierConnected(data: ConnectedPayload) {
		if (this.topTierAddresses.has(`${data.ip}:${data.port}`)) {
			this.logger.debug(
				{ pk: truncate(data.publicKey) },
				'Top tier node connected'
			);
		}
	}

	private logIfTopTierDisconnect(data: ClosePayload) {
		if (this.topTierAddresses.has(data.address)) {
			this.logger.debug(
				{ pk: truncate(data.publicKey), address: data.address },
				'Top tier node disconnected'
			);
		}
	}
}
