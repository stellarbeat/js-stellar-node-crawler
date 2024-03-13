import { Crawler } from './crawler';
import { pino } from 'pino';
import { createNode } from '@stellarbeat/js-stellar-node-connector';
import { CrawlerConfiguration } from './crawler-configuration';
import { ConnectionManager } from './peer-network-manager/connection-manager';
import { CrawlQueueManager } from './crawl-queue-manager';
import { AsyncCrawlQueue } from './crawl-queue';
import { MaxCrawlTimeManager } from './max-crawl-time-manager';
import { CrawlLogger } from './crawl-logger';
import { PeerNetworkManager } from './peer-network-manager/peer-network-manager';
import { StellarMessageHandler } from './peer-network-manager/stellar-message-handlers/stellar-message-handler';
import { Timer } from './utilities/timer';
import { ExternalizeStatementHandler } from './peer-network-manager/stellar-message-handlers/scp-envelope/scp-statement/externalize/externalize-statement-handler';
import { ScpStatementHandler } from './peer-network-manager/stellar-message-handlers/scp-envelope/scp-statement/scp-statement-handler';
import { ScpEnvelopeHandler } from './peer-network-manager/stellar-message-handlers/scp-envelope/scp-envelope-handler';
import { QuorumSetManager } from './peer-network-manager/quorum-set-manager';
import { StragglerTimer } from './peer-network-manager/straggler-timer';
import { PeerConnectionEventHandler } from './peer-network-manager/peer-connection-event-handler/peer-connection-event-handler';
import { OnPeerConnected } from './peer-network-manager/peer-connection-event-handler/on-peer-connected';
import { OnPeerConnectionClosed } from './peer-network-manager/peer-connection-event-handler/on-peer-connection-closed';
import { OnPeerData } from './peer-network-manager/peer-connection-event-handler/on-peer-data';
import { PeerNetworkStateManager } from './peer-network-manager/peer-network-state-manager';

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

	const stragglerTimer = new StragglerTimer(connectionManager, logger);
	const peerConnectionEventHandler = new PeerConnectionEventHandler(
		new OnPeerConnected(stragglerTimer, connectionManager, logger),
		new OnPeerConnectionClosed(quorumSetManager, logger),
		new OnPeerData(stellarMessageHandler, logger, connectionManager)
	);
	const consensusTimer = new Timer();

	const peerNetworkStateManager = new PeerNetworkStateManager(
		connectionManager,
		consensusTimer,
		stragglerTimer,
		logger
	);
	const peerNetworkManager = new PeerNetworkManager(
		connectionManager,
		quorumSetManager,
		peerConnectionEventHandler,
		peerNetworkStateManager
	);

	return new Crawler(
		config,
		crawlQueueManager,
		new MaxCrawlTimeManager(),
		peerNetworkManager,
		new CrawlLogger(connectionManager, crawlQueueManager, logger),
		logger
	);
}
export { CrawlerConfiguration } from './crawler-configuration';
