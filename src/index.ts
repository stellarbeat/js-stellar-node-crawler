import { Crawler } from './crawler';
import { pino } from 'pino';
import { QuorumSetManager } from './quorum-set-manager';
import { ScpEnvelopeHandler } from './message-handlers/scp-envelope-handler';
import { createNode } from '@stellarbeat/js-stellar-node-connector';
import { CrawlerConfiguration } from './crawler-configuration';
import { ConnectionManager } from './connection-manager';
import { ExternalizeStatementHandler } from './message-handlers/externalize/externalize-statement-handler';

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
			quorumSetManager,
			new ExternalizeStatementHandler(logger),
			logger
		),
		connectionManager,
		logger
	);
}
export { CrawlerConfiguration } from './crawler-configuration';
