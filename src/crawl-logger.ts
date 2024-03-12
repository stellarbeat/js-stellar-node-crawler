import { CrawlState } from './crawl-state';
import { P } from 'pino';
import { ConnectionManager } from './peer-network-manager/connection-manager';
import { CrawlQueueManager } from './crawl-queue-manager';

export class CrawlLogger {
	private loggingTimer?: NodeJS.Timeout;
	private _crawlState?: CrawlState;

	constructor(
		private connectionManager: ConnectionManager,
		private crawlQueueManager: CrawlQueueManager,
		private logger: P.Logger
	) {}

	get crawlState(): CrawlState {
		if (!this._crawlState) {
			throw new Error('CrawlState not set');
		}
		return this._crawlState;
	}

	start(crawlState: CrawlState, nodeAddressesLength: number) {
		console.time('crawl');
		this._crawlState = crawlState;
		this.logger.info(
			'Starting crawl with seed of ' + nodeAddressesLength + 'addresses.'
		);
		this.loggingTimer = setInterval(() => {
			this.logger.info({
				queueLength: this.crawlQueueManager.queueLength(),
				activeConnections:
					this.connectionManager.getNumberOfActiveConnections(),
				activeTopTiers: this.connectionManager
					.getActiveConnectionAddresses()
					.filter((address) => this.crawlState.topTierAddresses.has(address))
					.length
			});
		}, 10000);
	}

	stop() {
		this.logger.info('Crawl process complete');
		console.timeEnd('crawl');
		clearInterval(this.loggingTimer);
		this.crawlState.log();
		this.logger.info('crawl finished');
	}
}
