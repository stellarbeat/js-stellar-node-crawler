import { Crawl } from './crawl';
import { P } from 'pino';
import { CrawlQueueManager } from './crawl-queue-manager';
import { ConnectionManager } from './network-observer/connection-manager';
import { truncate } from './utilities/truncate';

export class CrawlLogger {
	private loggingTimer?: NodeJS.Timeout;
	private _crawl?: Crawl;

	constructor(
		private connectionManager: ConnectionManager,
		private crawlQueueManager: CrawlQueueManager,
		private logger: P.Logger
	) {}

	get crawl(): Crawl {
		if (!this._crawl) {
			throw new Error('Crawl not set');
		}
		return this._crawl;
	}

	start(crawl: Crawl) {
		console.time('crawl');
		this._crawl = crawl;
		this.logger.info(
			'Starting crawl with seed of ' + crawl.nodesToCrawl + 'addresses.'
		);
		this.loggingTimer = setInterval(() => {
			this.logger.info({
				queueLength: this.crawlQueueManager.queueLength(),
				activeConnections:
					this.connectionManager.getNumberOfActiveConnections(),
				activeTopTiers: this.connectionManager
					.getActiveConnectionAddresses()
					.filter((address) =>
						crawl.observation.topTierAddressesSet.has(address)
					).length
			});
		}, 10000);
	}

	stop() {
		this.logger.info('Crawl process complete');
		console.timeEnd('crawl');
		clearInterval(this.loggingTimer);
		this.logCrawlState();
		this.logger.info('crawl finished');
	}

	private logCrawlState() {
		this.logger.debug(
			{ peers: this.crawl.failedConnections },
			'Failed connections'
		);
		this.crawl.observation.peerNodes.getAll().forEach((peer) => {
			this.logger.info({
				ip: peer.key,
				pk: truncate(peer.publicKey),
				connected: peer.successfullyConnected,
				scp: peer.participatingInSCP,
				validating: peer.isValidating,
				overLoaded: peer.overLoaded,
				lagMS: peer.getMinLagMS(),
				incorrect: peer.isValidatingIncorrectValues
			});
		});
		this.logger.info(
			'Connection attempts: ' + this.crawl.crawledNodeAddresses.size
		);
		this.logger.info(
			'Detected public keys: ' + this.crawl.observation.peerNodes.size
		);
		this.logger.info(
			'Successful connections: ' +
				Array.from(this.crawl.observation.peerNodes.getAll().values()).filter(
					(peer) => peer.successfullyConnected
				).length
		);
		this.logger.info(
			'Validating nodes: ' +
				Array.from(this.crawl.observation.peerNodes.values()).filter(
					(node) => node.isValidating
				).length
		);
		this.logger.info(
			'Overloaded nodes: ' +
				Array.from(this.crawl.observation.peerNodes.values()).filter(
					(node) => node.overLoaded
				).length
		);

		this.logger.info(
			Array.from(this.crawl.observation.peerNodes.values()).filter(
				(node) => node.suppliedPeerList
			).length + ' supplied us with a peers list.'
		);
		this.logger.info(
			'Closed ledgers: ' +
				this.crawl.observation.slots.getConfirmedClosedSlotIndexes().length
		);
		const slowNodes = Array.from(
			this.crawl.observation.peerNodes.values()
		).filter((node) => (node.getMinLagMS() ?? 0) > 2000);

		this.logger.info(
			'Slow nodes: ' +
				slowNodes.length +
				' ' +
				slowNodes
					.map((node) => truncate(node.publicKey) + ':' + node.getMinLagMS())
					.join(', ')
		);
	}
}
