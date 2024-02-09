import { CrawlState } from './crawl-state';
import { P } from 'pino';
import { QueueObject } from 'async';
import { ConnectionManager } from './connection-manager';

export class CrawlLogger {
	loggingTimer?: NodeJS.Timeout;

	constructor(
		private crawlState: CrawlState,
		private connectionManager: ConnectionManager,
		private crawlQueue: QueueObject<any>,
		private logger: P.Logger
	) {}

	start(nodeAddressesLength: number) {
		console.time('crawl');
		this.logger.info(
			'Starting crawl with seed of ' + nodeAddressesLength + 'addresses.'
		);
		this.loggingTimer = setInterval(() => {
			this.logger.info(
				'nodes left in queue: ' +
					this.crawlQueue.length() +
					'. open connections: ' +
					this.connectionManager.getNumberOfActiveConnections()
			);
		}, 10000);
	}

	stop() {
		console.timeEnd('crawl');
		clearInterval(this.loggingTimer);
		this.crawlState.log();
		this.logger.info('crawl finished');
	}
}
