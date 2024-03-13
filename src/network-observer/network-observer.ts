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
import { NetworkObserverStateManager } from './network-observer-state-manager';
import { PeerEventHandler } from './peer-event-handler/peer-event-handler';

export enum NetworkObserverState {
	Idle,
	Syncing,
	Synced,
	Stopping
}

export interface SyncState {
	state: NetworkObserverState;
	networkHalted: boolean;
	topTierAddresses: Set<string>;
	peerNodes: PeerNodeCollection;
	crawlState: CrawlState; //todo: refactor out
}

export class NetworkObserver extends EventEmitter {
	private _crawlState?: CrawlState; //todo: refactor out crawlState

	constructor(
		private connectionManager: ConnectionManager,
		private quorumSetManager: QuorumSetManager,
		private peerEventHandler: PeerEventHandler,
		private stateManager: NetworkObserverStateManager,
		private syncingTimeoutMS: number
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

			this.stateManager.moveToSyncingState(topTierNodes);

			setTimeout(() => {
				this.stateManager.moveToSyncedState();
				resolve(this.connectionManager.getNumberOfActiveConnections());
			}, this.syncingTimeoutMS);
		});
	}

	public connectToNode(ip: string, port: number) {
		assert(this.stateManager.state === NetworkObserverState.Synced);
		this.connectionManager.connectToNode(ip, port);
	}

	public async shutdown() {
		return new Promise<void>((resolve) => {
			this.stateManager.moveToStoppingState(resolve);
		});
	}

	private createSyncState(): SyncState {
		return {
			peerNodes: this.crawlState.peerNodes,
			networkHalted: this.stateManager.isNetworkHalted,
			crawlState: this.crawlState,
			state: this.stateManager.state,
			topTierAddresses: this.stateManager.topTierAddresses
		};
	}

	private onPeerConnected(data: ConnectedPayload) {
		this.peerEventHandler.onConnected(data, this.createSyncState());
	}

	private onPeerConnectionClose(data: ClosePayload): void {
		this.peerEventHandler.onConnectionClose(data, this.createSyncState());
		this.emit('disconnect', data);
	}

	private onPeerData(data: DataPayload): void {
		const result = this.peerEventHandler.onData(data, this.createSyncState());
		if (result.closedLedger) {
			this.stateManager.ledgerCloseConfirmed(
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
