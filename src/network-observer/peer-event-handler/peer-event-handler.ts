import {
	ClosePayload,
	ConnectedPayload,
	DataPayload
} from '../connection-manager';
import { Ledger } from '../../crawler';
import { NodeAddress } from '../../node-address';
import { OnPeerConnected } from './on-peer-connected';
import { OnPeerConnectionClosed } from './on-peer-connection-closed';
import { OnPeerData } from './on-peer-data';
import { Observation } from '../observation';

export class PeerEventHandler {
	constructor(
		private onConnectedHandler: OnPeerConnected,
		private onConnectionCloseHandler: OnPeerConnectionClosed,
		private onPeerDataHandler: OnPeerData
	) {}

	public onConnected(data: ConnectedPayload, observation: Observation) {
		this.onConnectedHandler.handle(data, observation);
	}

	public onConnectionClose(data: ClosePayload, observation: Observation) {
		this.onConnectionCloseHandler.handle(data, observation);
	}

	public onData(
		data: DataPayload,
		observation: Observation
	): {
		closedLedger: Ledger | null;
		peers: Array<NodeAddress>;
	} {
		return this.onPeerDataHandler.handle(data, observation);
	}
}
