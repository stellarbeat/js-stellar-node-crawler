import {
	ClosePayload,
	ConnectedPayload,
	DataPayload
} from '../connection-manager';
import { SyncState } from '../network-observer';
import { Ledger } from '../../crawler';
import { NodeAddress } from '../../node-address';
import { OnPeerConnected } from './on-peer-connected';
import { OnPeerConnectionClosed } from './on-peer-connection-closed';
import { OnPeerData } from './on-peer-data';

export class PeerEventHandler {
	constructor(
		private onConnectedHandler: OnPeerConnected,
		private onConnectionCloseHandler: OnPeerConnectionClosed,
		private onPeerDataHandler: OnPeerData
	) {}

	public onConnected(data: ConnectedPayload, syncState: SyncState) {
		this.onConnectedHandler.handle(data, syncState);
	}

	public onConnectionClose(data: ClosePayload, syncState: SyncState) {
		this.onConnectionCloseHandler.handle(data, syncState);
	}

	public onData(
		data: DataPayload,
		syncState: SyncState
	): {
		closedLedger: Ledger | null;
		peers: Array<NodeAddress>;
	} {
		return this.onPeerDataHandler.handle(data, syncState);
	}
}
