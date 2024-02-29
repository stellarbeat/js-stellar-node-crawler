import { Crawler } from './crawler';
import { pino } from 'pino';
import { QuorumSetManager } from './quorum-set-manager';
import { ScpEnvelopeHandler } from './message-handlers/scp-envelope-handler';
import { createNode } from '@stellarbeat/js-stellar-node-connector';
import { CrawlerConfiguration } from './crawler-configuration';
import { ConnectionManager } from './connection-manager';
import { NodeConfig } from '@stellarbeat/js-stellar-node-connector/lib/node-config';
import { Keypair } from '@stellar/stellar-base';
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
	const ledgerCloseDetectorNodeConfig: NodeConfig = JSON.parse(
		JSON.stringify(config.nodeConfig)
	);
	//ledgerCloseDetectorNodeConfig.listeningPort++;
	ledgerCloseDetectorNodeConfig.privateKey = Keypair.random().secret(); //todo: this should be the fixed public key

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
		/*new LedgerCloseDetector(
			ledgerCLoseConnectionManager,
			new CachedLedgerCloseScpEnvelopeHandler(
				new LedgerCloseScpEnvelopeHandler(new SlotCloser(), logger)
			),
			hash(Buffer.from(ledgerCloseDetectorNodeConfig.network)),
			logger
		),*/
		logger
	);
}
export { CrawlerConfiguration } from './crawler-configuration';
