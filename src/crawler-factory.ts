import { Crawler, CrawlerConfiguration } from './crawler';
import { QuorumSetManager } from './quorum-set-manager';
import * as P from 'pino';
import { ScpManager } from './scp-manager';

export class CrawlerFactory {
	static createCrawler(
		config: CrawlerConfiguration,
		logger?: P.Logger
	): Crawler {
		if (!logger) {
			logger = CrawlerFactory.initializeDefaultLogger();
		}

		const quorumSetManager = new QuorumSetManager(logger);
		return new Crawler(
			config,
			quorumSetManager,
			new ScpManager(quorumSetManager, logger),
			logger
		);
	}

	static initializeDefaultLogger(): P.Logger {
		return P({
			level: process.env.LOG_LEVEL || 'info',
			base: undefined
		});
	}
}
