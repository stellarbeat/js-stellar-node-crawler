import { Crawler } from './crawler';
import { pino } from 'pino';
import { createNode } from '@stellarbeat/js-stellar-node-connector';
import { CrawlerConfiguration } from './crawler-configuration';
import { ConnectionManager } from './network-observer/connection-manager';
import { CrawlQueueManager } from './crawl-queue-manager';
import { AsyncCrawlQueue } from './crawl-queue';
import { MaxCrawlTimeManager } from './max-crawl-time-manager';
import { CrawlLogger } from './crawl-logger';
import { NetworkObserver } from './network-observer/network-observer';
import { StellarMessageHandler } from './network-observer/peer-event-handler/stellar-message-handlers/stellar-message-handler';
import { Timer } from './utilities/timer';
import { ExternalizeStatementHandler } from './network-observer/peer-event-handler/stellar-message-handlers/scp-envelope/scp-statement/externalize/externalize-statement-handler';
import { ScpStatementHandler } from './network-observer/peer-event-handler/stellar-message-handlers/scp-envelope/scp-statement/scp-statement-handler';
import { ScpEnvelopeHandler } from './network-observer/peer-event-handler/stellar-message-handlers/scp-envelope/scp-envelope-handler';
import { QuorumSetManager } from './network-observer/quorum-set-manager';
import { StragglerTimer } from './network-observer/straggler-timer';
import { OnPeerConnected } from './network-observer/peer-event-handler/on-peer-connected';
import { OnPeerConnectionClosed } from './network-observer/peer-event-handler/on-peer-connection-closed';
import { OnPeerData } from './network-observer/peer-event-handler/on-peer-data';
import { ObservationManager } from './network-observer/observation-manager';
import { PeerEventHandler } from './network-observer/peer-event-handler/peer-event-handler';
import { Timers } from './utilities/timers';
import { TimerFactory } from './utilities/timer-factory';
import { ConsensusTimer } from './network-observer/consensus-timer';
import { ObservationFactory } from './network-observer/observation-factory';

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
	const quorumSetManager = new QuorumSetManager(
		connectionManager,
		config.quorumSetRequestTimeoutMS,
		logger
	);
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

	const timers = new Timers(new TimerFactory());
	const stragglerTimer = new StragglerTimer(
		connectionManager,
		timers,
		config.peerStraggleTimeoutMS,
		logger
	);
	const peerEventHandler = new PeerEventHandler(
		new OnPeerConnected(stragglerTimer, connectionManager, logger),
		new OnPeerConnectionClosed(quorumSetManager, logger),
		new OnPeerData(stellarMessageHandler, logger, connectionManager)
	);
	const consensusTimer = new ConsensusTimer(
		new Timer(),
		config.consensusTimeoutMS
	);

	const networkObserverStateManager = new ObservationManager(
		connectionManager,
		consensusTimer,
		stragglerTimer,
		config.syncingTimeoutMS,
		logger
	);
	const peerNetworkManager = new NetworkObserver(
		new ObservationFactory(),
		connectionManager,
		quorumSetManager,
		peerEventHandler,
		networkObserverStateManager
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
