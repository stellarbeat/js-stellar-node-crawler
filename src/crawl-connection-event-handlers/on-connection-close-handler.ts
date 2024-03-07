import { PublicKey } from '@stellarbeat/js-stellarbeat-shared';
import { CrawlState } from '../crawl-state';
import { QuorumSetManager } from '../quorum-set-manager';
import { CrawlQueueManager } from '../crawl-queue-manager';
import { P } from 'pino';
import { truncate } from '../utilities/truncate';

export class OnConnectionCloseHandler {
	constructor(
		private quorumSetManager: QuorumSetManager,
		private crawlQueueManager: CrawlQueueManager,
		private logger: P.Logger
	) {}

	public onConnectionClose(
		nodeAddress: string,
		publicKey: PublicKey | undefined,
		crawlState: CrawlState,
		localTime: Date
	): void {
		if (publicKey) {
			this.performCleanupForClosedConnection(
				publicKey,
				nodeAddress,
				crawlState,
				localTime
			);
			this.logTopTierDisconnect(crawlState, publicKey, nodeAddress);
		} else {
			this.updateFailedConnections(nodeAddress, crawlState);
		}

		this.crawlQueueManager.completeCrawlQueueTask(
			crawlState.crawlQueueTaskDoneCallbacks, //todo: Move
			nodeAddress
		);
	}

	private logTopTierDisconnect(
		crawlState: CrawlState,
		publicKey: string,
		nodeAddress: string
	) {
		if (crawlState.topTierNodes.has(publicKey)) {
			this.logger.info(
				{ pk: truncate(publicKey), address: nodeAddress },
				'Top tier node disconnected'
			);
		}
	}

	private performCleanupForClosedConnection(
		publicKey: PublicKey,
		nodeAddress: string,
		crawlState: CrawlState,
		localTime: Date
	): void {
		this.quorumSetManager.onNodeDisconnected(publicKey, crawlState);
		const peer = crawlState.peerNodes.get(publicKey);
		if (peer && peer.key === nodeAddress) {
			const timeout = crawlState.listenTimeouts.get(publicKey);
			peer.disconnected = true;
			peer.disconnectionTime = localTime;
			if (timeout) clearTimeout(timeout);
			crawlState.listenTimeouts.delete(publicKey);
		} //if peer.key differs from remoteAddress,then this is a connection to an ip that reuses a publicKey. These connections are ignored, and we should make sure we don't interfere with a possible connection to the other ip that uses the public key.
	}

	private updateFailedConnections(
		nodeAddress: string,
		crawlState: CrawlState
	): void {
		crawlState.failedConnections.push(nodeAddress);
	}
}
