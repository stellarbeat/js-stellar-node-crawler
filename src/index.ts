import { Crawler } from './crawler';
import { pino } from 'pino';
import { QuorumSetManager } from './quorum-set-manager';
import { createNode } from '@stellarbeat/js-stellar-node-connector';
import { CrawlerConfiguration } from './crawler-configuration';
import { ConnectionManager } from './connection-manager';
import { ExternalizeStatementHandler } from './stellar-message-handlers/scp-envelope/scp-statement/externalize/externalize-statement-handler';
import { ScpEnvelopeHandler } from './stellar-message-handlers/scp-envelope/scp-envelope-handler';
import { ScpStatementHandler } from './stellar-message-handlers/scp-envelope/scp-statement/scp-statement-handler';
import { CrawlQueueManager } from './crawl-queue-manager';
import { AsyncCrawlQueue } from './crawl-queue';

export { Crawler } from './crawler';
export { CrawlResult } from './crawl-result';
export { PeerNode } from './peer-node';
export { default as jsonStorage } from './utilities/json-storage';

export function createCrawler(
	config: CrawlerConfiguration,
	logger?: pino.Logger
): Crawler {
	if (!logger) {
		logger = pino({
			level: process.env.LOG_LEVEL || 'info',
			base: undefined
		});
	}

	const node = createNode(config.nodeConfig, logger);
	const connectionManager = new ConnectionManager(
		node,
		config.blackList,
		logger
	);
	const quorumSetManager = new QuorumSetManager(connectionManager, logger);

	return new Crawler(
		config,
		quorumSetManager,
		new ScpEnvelopeHandler(
			new ScpStatementHandler(
				quorumSetManager,
				new ExternalizeStatementHandler(logger),
				logger
			)
		),
		connectionManager,
		new CrawlQueueManager(
			new AsyncCrawlQueue(config.maxOpenConnections),
			logger
		),
		logger
	);
}
export { CrawlerConfiguration } from './crawler-configuration';
