import { CrawlState } from '../crawl-state';
import {
	ClosePayload,
	ConnectedPayload,
	ConnectionManager,
	DataPayload
} from './connection-manager';
import { QuorumSetManager } from './quorum-set-manager';
import { NodeAddress } from '../node-address';
import { EventEmitter } from 'events';
import * as assert from 'assert';
import { PeerNodeCollection } from '../peer-node-collection';
import { PeerNetworkStateManager } from './peer-network-state-manager';
import { PeerConnectionEventHandler } from './peer-connection-event-handler/peer-connection-event-handler';

export enum PeerNetworkManagerState {
	Idle,
	Syncing,
	Synced,
	Stopping
}

export interface SyncState {
	state: PeerNetworkManagerState;
	networkHalted: boolean;
	topTierAddresses: Set<string>;
	peerNodes: PeerNodeCollection;
	crawlState: CrawlState; //todo: refactor out
}

export class PeerNetworkManager extends EventEmitter {
	public static readonly NETWORK_CONSENSUS_TIMEOUT = 90000; //90 seconds before we declare the network stuck.
	private static readonly SYNCING_TIMEOUT = 10000;

	private _crawlState?: CrawlState; //todo: refactor out crawlState

	constructor(
		private connectionManager: ConnectionManager,
		private quorumSetManager: QuorumSetManager,
		private peerConnectionHandler: PeerConnectionEventHandler,
		private peerNetworkStateManager: PeerNetworkStateManager
	) {
		super();
		this.connectionManager.on('connected', (data: ConnectedPayload) => {
			this.onPeerConnected(data);
		});
		this.connectionManager.on('close', (data: ClosePayload) => {
			this.onPeerConnectionClose(data);
		});
		this.connectionManager.on('data', (data: DataPayload) => {
			this.onPeerData(data);
		});
	}

	public async sync(
		topTierNodes: NodeAddress[],
		crawlState: CrawlState
	): Promise<number> {
		return new Promise<number>((resolve) => {
			this._crawlState = crawlState;

			this.peerNetworkStateManager.moveToSyncingState(topTierNodes);

			setTimeout(() => {
				this.peerNetworkStateManager.moveToSyncedState();
				resolve(this.connectionManager.getNumberOfActiveConnections());
			}, PeerNetworkManager.SYNCING_TIMEOUT);
		});
	}

	public connectToNode(ip: string, port: number) {
		assert(
			this.peerNetworkStateManager.state === PeerNetworkManagerState.Synced
		);
		this.connectionManager.connectToNode(ip, port);
	}

	public async shutdown() {
		return new Promise<void>((resolve) => {
			this.peerNetworkStateManager.moveToStoppingState(resolve);
		});
	}

	private createSyncState(): SyncState {
		return {
			peerNodes: this.crawlState.peerNodes,
			networkHalted: this.peerNetworkStateManager.isNetworkHalted,
			crawlState: this.crawlState,
			state: this.peerNetworkStateManager.state,
			topTierAddresses: this.peerNetworkStateManager.topTierAddresses
		};
	}

	private onPeerConnected(data: ConnectedPayload) {
		this.peerConnectionHandler.onConnected(data, this.createSyncState());
	}

	private onPeerConnectionClose(data: ClosePayload): void {
		this.peerConnectionHandler.onConnectionClose(data, this.createSyncState());
		this.emit('disconnect', data);
	}

	private onPeerData(data: DataPayload): void {
		const result = this.peerConnectionHandler.onData(
			data,
			this.createSyncState()
		);
		if (result.closedLedger) {
			this.peerNetworkStateManager.ledgerCloseConfirmed(
				this.crawlState,
				result.closedLedger
			);
		}

		if (result.peers.length > 0) this.emit('peers', result.peers);
	}

	private get crawlState(): CrawlState {
		if (!this._crawlState) {
			throw new Error('CrawlState not set');
		}
		return this._crawlState;
	}
}
