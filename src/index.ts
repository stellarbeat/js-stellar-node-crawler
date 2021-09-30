import { Crawler, CrawlerConfiguration } from './crawler';
import * as P from 'pino';
import { QuorumSetManager } from './quorum-set-manager';
import { ScpManager } from './scp-manager';
import { createNode } from '@stellarbeat/js-stellar-node-connector';

export { Crawler, CrawlerConfiguration } from './crawler';
export { PeerNode } from './peer-node';
export { default as jsonStorage } from './json-storage';

export function createCrawler(
	config: CrawlerConfiguration,
	logger?: P.Logger
): Crawler {
	if (!logger) {
		logger = P({
			level: process.env.LOG_LEVEL || 'info',
			base: undefined
		});
	}

	const quorumSetManager = new QuorumSetManager(logger);

	const node = createNode(config.nodeConfig, logger);
	return new Crawler(
		config,
		node,
		quorumSetManager,
		new ScpManager(quorumSetManager, logger),
		logger
	);
}
