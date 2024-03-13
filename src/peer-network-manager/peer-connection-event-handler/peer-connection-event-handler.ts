import { StragglerTimer } from '../straggler-timer';
import {
	ClosePayload,
	ConnectedPayload,
	ConnectionManager,
	DataPayload
} from '../connection-manager';
import { QuorumSetManager } from '../quorum-set-manager';
import { StellarMessageHandler } from '../stellar-message-handlers/stellar-message-handler';
import { P } from 'pino';
import { SyncState } from '../peer-network-manager';
import { Ledger } from '../../crawler';
import { NodeAddress } from '../../node-address';
import { OnPeerConnected } from './on-peer-connected';
import { OnPeerConnectionClosed } from './on-peer-connection-closed';
import { OnPeerData } from './on-peer-data';

export class PeerConnectionEventHandler {
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
