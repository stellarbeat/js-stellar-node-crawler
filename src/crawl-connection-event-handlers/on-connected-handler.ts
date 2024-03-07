import { PublicKey } from '@stellarbeat/js-stellarbeat-shared';
import { ConnectedPayload, ConnectionManager } from '../connection-manager';
import { CrawlQueueManager } from '../crawl-queue-manager';
import { DisconnectTimeout } from '../disconnect-timeout';
import { PeerNodeCollection } from '../peer-node-collection';
import { P } from 'pino';
import { truncate } from '../utilities/truncate';

export class OnConnectedHandler {
	constructor(
		private connectionManager: ConnectionManager,
		private crawlQueueManager: CrawlQueueManager,
		private disconnectTimeout: DisconnectTimeout,
		private logger: P.Logger
	) {}

	public onConnected(
		data: ConnectedPayload,
		peerNodes: PeerNodeCollection,
		topTierNodes: Set<PublicKey>,
		listenTimeouts: Map<PublicKey, NodeJS.Timeout>,
		localTime: Date
	): undefined | Error {
		if (topTierNodes.has(data.publicKey)) {
			this.logger.info(
				{ pk: truncate(data.publicKey) },
				'Top tier node connected'
			);
		}
		const peerNodeOrError = peerNodes.addSuccessfullyConnected(
			data.publicKey,
			data.ip,
			data.port,
			data.nodeInfo,
			localTime
		);

		if (peerNodeOrError instanceof Error) {
			this.connectionManager.disconnectByAddress(
				`${data.ip}:${data.port}`,
				peerNodeOrError
			);
			return;
		}

		this.disconnectTimeout.start(
			peerNodeOrError,
			0,
			peerNodes,
			topTierNodes,
			listenTimeouts,
			() => this.connectionManager.disconnectByAddress(peerNodeOrError.key),
			() => this.crawlQueueManager.readyWithNonTopTierPeers()
		);
	}
}
