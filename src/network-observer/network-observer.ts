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
import { ObservationManager } from './observation-manager';
import { PeerEventHandler } from './peer-event-handler/peer-event-handler';
import { Observation } from './observation';

export enum ObservationState {
	Idle,
	Syncing,
	Synced,
	Stopping,
	Stopped
}

export class NetworkObserver extends EventEmitter {
	private _observation: Observation | null = null;

	constructor(
		private connectionManager: ConnectionManager,
		private quorumSetManager: QuorumSetManager,
		private peerEventHandler: PeerEventHandler,
		private observationManager: ObservationManager,
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

	public async observe(
		topTierNodes: NodeAddress[],
		crawlState: CrawlState
	): Promise<number> {
		return new Promise<number>((resolve) => {
			this._observation = this.createObservation(crawlState, topTierNodes);
			this.observationManager.startSync(this._observation);

			setTimeout(() => {
				this.observationManager.syncCompleted(this.observation);
				resolve(this.connectionManager.getNumberOfActiveConnections());
			}, this.syncingTimeoutMS);
		});
	}

	public connectToNode(ip: string, port: number) {
		assert(this.observation.state === ObservationState.Synced);
		this.connectionManager.connectToNode(ip, port);
	}

	public async stop() {
		return new Promise<Observation>((resolve) => {
			this.observationManager.moveToStoppingState(this.observation, () =>
				this.onObservationStopped(resolve)
			);
		});
	}

	private onObservationStopped(
		resolve: (observation: Observation) => void
	): void {
		resolve(this.observation);
	}

	private createObservation(
		crawlState: CrawlState,
		topTierAddresses: NodeAddress[]
	): Observation {
		return new Observation(topTierAddresses, crawlState.peerNodes, crawlState);
	}

	private onPeerConnected(data: ConnectedPayload) {
		this.peerEventHandler.onConnected(data, this.observation);
	}

	private onPeerConnectionClose(data: ClosePayload): void {
		this.peerEventHandler.onConnectionClose(data, this.observation);
		this.emit('disconnect', data);
	}

	private onPeerData(data: DataPayload): void {
		const result = this.peerEventHandler.onData(data, this.observation);
		if (result.closedLedger) {
			this.observationManager.ledgerCloseConfirmed(
				this.observation,
				result.closedLedger
			);
		}

		if (result.peers.length > 0) this.emit('peers', result.peers);
	}

	private get observation(): Observation {
		if (!this._observation) {
			throw new Error('Observation not set');
		}
		return this._observation;
	}
}
