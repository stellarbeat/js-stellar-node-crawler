import { ConnectedPayload, ConnectionManager } from '../connection-manager';
import { StragglerTimer } from '../straggler-timer';
import { P } from 'pino';
import { truncate } from '../../utilities/truncate';
import { PeerNodeCollection } from '../../peer-node-collection';
import { Observation } from '../observation';
import { ObservationState } from '../observation-state';

export class OnPeerConnected {
	constructor(
		private stragglerHandler: StragglerTimer,
		private connectionManager: ConnectionManager,
		private logger: P.Logger
	) {}
	public handle(data: ConnectedPayload, observation: Observation) {
		this.logIfTopTierConnected(data, observation);
		const peerNodeOrError = this.addPeerNode(data, observation.peerNodes);

		if (peerNodeOrError instanceof Error) {
			this.disconnect(data.ip, data.port, peerNodeOrError);
			return peerNodeOrError;
		}

		if (observation.isNetworkHalted()) {
			return this.collectMinimalDataAndDisconnect(data);
		}

		this.handleConnectedByState(observation, data);
	}

	private handleConnectedByState(
		observation: Observation,
		data: ConnectedPayload
	) {
		switch (observation.state) {
			case ObservationState.Idle:
				return this.disconnectBecauseIdle(data);
			case ObservationState.Stopping:
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

	private collectMinimalDataAndDisconnect(data: ConnectedPayload) {
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

	private logIfTopTierConnected(
		data: ConnectedPayload,
		observation: Observation
	) {
		if (observation.topTierAddressesSet.has(`${data.ip}:${data.port}`)) {
			this.logger.debug(
				{ pk: truncate(data.publicKey) },
				'Top tier node connected'
			);
		}
	}
}
