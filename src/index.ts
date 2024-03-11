import { Crawler } from './crawler';
import { pino } from 'pino';
import { QuorumSetManager } from './peer-listener/quorum-set-manager';
import { createNode } from '@stellarbeat/js-stellar-node-connector';
import { CrawlerConfiguration } from './crawler-configuration';
import { ConnectionManager } from './connection-manager';
import { ExternalizeStatementHandler } from './peer-listener/stellar-message-handlers/scp-envelope/scp-statement/externalize/externalize-statement-handler';
import { ScpEnvelopeHandler } from './peer-listener/stellar-message-handlers/scp-envelope/scp-envelope-handler';
import { ScpStatementHandler } from './peer-listener/stellar-message-handlers/scp-envelope/scp-statement/scp-statement-handler';
import { CrawlQueueManager } from './crawl-queue-manager';
import { AsyncCrawlQueue } from './crawl-queue';
import { StellarMessageHandler } from './peer-listener/stellar-message-handlers/stellar-message-handler';
import { PeerListener } from './peer-listener/peer-listener';

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
	const crawlQueueManager = new CrawlQueueManager(
		new AsyncCrawlQueue(config.maxOpenConnections),
		logger
	);

	const scpEnvelopeHandler = new ScpEnvelopeHandler(
		new ScpStatementHandler(
			quorumSetManager,
			new ExternalizeStatementHandler(logger),
			logger
		)
	);
	const stellarMessageHandler = new StellarMessageHandler(
		scpEnvelopeHandler,
		quorumSetManager,
		logger
	);

	const peerListener = new PeerListener(
		connectionManager,
		quorumSetManager,
		stellarMessageHandler,
		logger
	);

	return new Crawler(
		config,
		stellarMessageHandler,
		connectionManager,
		crawlQueueManager,
		peerListener,
		logger
	);
}
export { CrawlerConfiguration } from './crawler-configuration';
