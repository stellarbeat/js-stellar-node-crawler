import { P } from 'pino';
import { CrawlState } from '../crawl-state';
import { truncate } from '../utilities/truncate';
import {
	ClosePayload,
	ConnectedPayload,
	ConnectionManager,
	DataPayload
} from './connection-manager';
import { QuorumSetManager } from './quorum-set-manager';
import { StellarMessageHandler } from './stellar-message-handlers/stellar-message-handler';
import { NodeAddress } from '../node-address';
import { Ledger } from '../crawler';
import { EventEmitter } from 'events';
import { ConsensusTimerManager } from './consensus-timer-manager';
import * as assert from 'assert';

export enum PeerNetworkManagerState {
	Idle,
	Syncing,
	Synced,
	Stopping
}

export class PeerNetworkManager extends EventEmitter {
	private static readonly NETWORK_CONSENSUS_TIMEOUT = 90000; //90 seconds before we declare the network stuck.
	private static readonly PEER_STRAGGLE_TIMEOUT = 10000; //if the network has externalized, you get 10 seconds to catch up.

	private topTierAddresses: Set<string> = new Set();

	private _crawlState?: CrawlState; //todo: refactor out crawlState

	private state: PeerNetworkManagerState = PeerNetworkManagerState.Idle;
	private networkHalted: boolean = false;

	constructor(
		private connectionManager: ConnectionManager,
		private quorumSetManager: QuorumSetManager,
		private stellarMessageHandler: StellarMessageHandler,
		private networkConsensusTimerManager: ConsensusTimerManager,
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

	getState(): PeerNetworkManagerState {
		return this.state;
	}

	get crawlState(): CrawlState {
		if (!this._crawlState) {
			throw new Error('CrawlState not set');
		}
		return this._crawlState;
	}

	public async sync(
		topTierNodes: NodeAddress[],
		crawlState: CrawlState
	): Promise<number> {
		return new Promise<number>((resolve) => {
			this._crawlState = crawlState;

			this.moveToSyncingState(topTierNodes);

			setTimeout(() => {
				this.moveToSyncedState();
				resolve(this.connectionManager.getNumberOfActiveConnections());
			}, 10000);
		});
	}

	private moveToSyncingState(topTierNodes: NodeAddress[]) {
		assert(this.state === PeerNetworkManagerState.Idle);
		this.state = PeerNetworkManagerState.Syncing;
		this.networkHalted = false;

		topTierNodes.forEach((address) => {
			this.connectionManager.connectToNode(address[0], address[1]);
			this.topTierAddresses.add(`${address[0]}:${address[1]}`);
		});
	}

	private moveToSyncedState() {
		assert(this.state === PeerNetworkManagerState.Syncing);
		this.state = PeerNetworkManagerState.Synced;
		this.startNetworkConsensusTimer();
	}

	private moveToStoppingState(callback: () => void) {
		this.state = PeerNetworkManagerState.Stopping;
		this.networkConsensusTimerManager.stopTimer();
		if (this.connectionManager.getActiveConnectionAddresses().length === 0) {
			return this.moveToIdleState(callback);
		}

		//give straggling top tier nodes a chance and then shut down.
		setTimeout(() => {
			this.moveToIdleState(callback);
		}, PeerNetworkManager.PEER_STRAGGLE_TIMEOUT);
	}

	private moveToIdleState(callback: () => void) {
		this.connectionManager.shutdown();
		this.state = PeerNetworkManagerState.Idle;
		callback();
	}

	public connectToNode(ip: string, port: number) {
		this.connectionManager.connectToNode(ip, port);
	}

	public async shutdown() {
		return new Promise<void>((resolve) => {
			this.moveToStoppingState(resolve);
		});
	}

	private startNetworkConsensusTimer() {
		this.networkConsensusTimerManager.startTimer(
			PeerNetworkManager.NETWORK_CONSENSUS_TIMEOUT,
			() => this.onNetworkHalted()
		);
	}

	private onNetworkHalted() {
		this.logger.info('Network consensus timeout');
		this.networkHalted = true;
		this.startStragglerTimeoutForActivePeers();
	}

	private onLedgerCloseConfirmation(crawlState: CrawlState, ledger: Ledger) {
		if (this.state !== PeerNetworkManagerState.Synced) return;
		if (this.networkHalted) return;

		crawlState.updateLatestConfirmedClosedLedger(ledger);

		this.startStragglerTimeoutForActivePeers();

		this.startNetworkConsensusTimer();
	}

	private startStragglerTimeoutForActivePeers() {
		const activePeers = this.connectionManager
			.getActiveConnectionAddresses()
			.filter((address) => {
				return !this.crawlState.topTierAddresses.has(address);
			});
		if (activePeers.length === 0) return; //no potential stragglers
		setTimeout(() => {
			this.logger.debug({ activePeers }, 'Straggler timeout hit');
			activePeers.forEach((address) => {
				this.connectionManager.disconnectByAddress(address);
			});
		}, PeerNetworkManager.PEER_STRAGGLE_TIMEOUT);
	}

	private onConnected(data: ConnectedPayload): undefined | Error {
		this.logIfTopTierConnected(data);
		const peerNodeOrError = this.addPeerNode(data, new Date());

		if (peerNodeOrError instanceof Error) {
			this.disconnectPeer(`${data.ip}:${data.port}`, peerNodeOrError);
			return peerNodeOrError;
		}

		if (this.networkHalted) {
			//try to gather minimal data from the peer and disconnect
			setTimeout(() => {
				this.disconnectPeer(`${data.ip}:${data.port}`);
			}, PeerNetworkManager.PEER_STRAGGLE_TIMEOUT);
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
			this.state === PeerNetworkManagerState.Synced,
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

	private disconnectPeer(address: string, error?: Error) {
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
