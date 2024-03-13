import {
	ClosePayload,
	ConnectedPayload,
	ConnectionManager
} from '../connection-manager';
import { NetworkObserverState, SyncState } from '../network-observer';
import { StragglerTimer } from '../straggler-timer';
import { P } from 'pino';
import { truncate } from '../../utilities/truncate';
import { PeerNodeCollection } from '../../peer-node-collection';

export class OnPeerConnected {
	constructor(
		private stragglerHandler: StragglerTimer,
		private connectionManager: ConnectionManager,
		private logger: P.Logger
	) {}
	public handle(data: ConnectedPayload, syncState: SyncState) {
		this.logIfTopTierConnected(data, syncState);
		const peerNodeOrError = this.addPeerNode(data, syncState.peerNodes);

		if (peerNodeOrError instanceof Error) {
			this.disconnect(data.ip, data.port, peerNodeOrError);
			return peerNodeOrError;
		}

		if (this.networkIsHalted(syncState)) {
			return this.collectMinimalDataAndDisconnect(data);
		}

		this.handleConnectedByState(syncState, data);
	}

	private handleConnectedByState(syncState: SyncState, data: ConnectedPayload) {
		switch (syncState.state) {
			case NetworkObserverState.Idle:
				return this.disconnectBecauseIdle(data);
			case NetworkObserverState.Stopping:
				return this.collectMinimalDataAndDisconnect(data);
			default:
				return;
		}
	}

	private disconnectBecauseIdle(data: ConnectedPayload) {
		return this.disconnect(data.ip, data.port, this.createIdleConnectedError());
	}

	private createIdleConnectedError() {
		return new Error('Connected while idle');
	}

	private isIdleState(syncState: SyncState) {
		return syncState.state === NetworkObserverState.Idle;
	}

	private isStoppingState(syncState: SyncState) {
		return syncState.state === NetworkObserverState.Stopping;
	}
	private collectMinimalDataAndDisconnect(data: ConnectedPayload) {
		return this.startStragglerTimeout(data);
	}

	private networkIsHalted(syncState: SyncState) {
		return syncState.networkHalted;
	}

	private handleConnectedWhenNetworkIsHalted(data: ConnectedPayload) {
		return this.startStragglerTimeout(data);
	}

	private startStragglerTimeout(data: ConnectedPayload) {
		return this.stragglerHandler.startStragglerTimeout([
			data.ip + ':' + data.port
		]);
	}

	private disconnect(ip: string, port: number, error?: Error) {
		this.connectionManager.disconnectByAddress(`${ip}:${port}`, error);
	}

	private addPeerNode(data: ConnectedPayload, peerNodes: PeerNodeCollection) {
		return peerNodes.addSuccessfullyConnected(
			data.publicKey,
			data.ip,
			data.port,
			data.nodeInfo
		);
	}

	private logIfTopTierConnected(data: ConnectedPayload, syncState: SyncState) {
		if (syncState.topTierAddresses.has(`${data.ip}:${data.port}`)) {
			this.logger.debug(
				{ pk: truncate(data.publicKey) },
				'Top tier node connected'
			);
		}
	}
}
