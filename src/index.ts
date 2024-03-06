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
import { DisconnectTimeout } from './disconnect-timeout';
import { OnConnectedHandler } from './crawl-connection-event-handlers/on-connected-handler';
import { OnDataHandler } from './crawl-connection-event-handlers/on-data-handler';
import { StellarMessageHandler } from './stellar-message-handlers/stellar-message-handler';
import { OnConnectionCloseHandler } from './crawl-connection-event-handlers/on-connection-close-handler';

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
	const onConnectedHandler = new OnConnectedHandler(
		connectionManager,
		crawlQueueManager,
		new DisconnectTimeout(logger)
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

	const onStellarMessageHandler = new OnDataHandler(
		connectionManager,
		stellarMessageHandler,
		logger
	);
	const onConnectionCloseHandler = new OnConnectionCloseHandler(
		quorumSetManager,
		crawlQueueManager
	);

	return new Crawler(
		config,
		quorumSetManager,
		stellarMessageHandler,
		connectionManager,
		crawlQueueManager,
		onConnectedHandler,
		onStellarMessageHandler,
		onConnectionCloseHandler,
		logger
	);
}
export { CrawlerConfiguration } from './crawler-configuration';
