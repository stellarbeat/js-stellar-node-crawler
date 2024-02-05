import { Logger } from 'pino';
import { truncate } from './truncate';
import { CrawlState } from './crawl-state';

export class CrawlStateLogger {
	static log(crawlState: CrawlState, logger: Logger) {
		logger.info({ peers: crawlState.failedConnections }, 'Failed connections');
		crawlState.peerNodes.forEach((peer) => {
			logger.info({
				ip: peer.key,
				pk: truncate(peer.publicKey),
				connected: peer.successfullyConnected,
				scp: peer.participatingInSCP,
				validating: peer.isValidating,
				overLoaded: peer.overLoaded
			});
		});
		logger.info('Connection attempts: ' + crawlState.crawledNodeAddresses.size);
		logger.info('Detected public keys: ' + crawlState.peerNodes.size);
		logger.info(
			'Successful connections: ' +
				Array.from(crawlState.peerNodes.values()).filter(
					(peer) => peer.successfullyConnected
				).length
		);
		logger.info(
			'Validating nodes: ' +
				Array.from(crawlState.peerNodes.values()).filter(
					(node) => node.isValidating
				).length
		);
		logger.info(
			'Overloaded nodes: ' +
				Array.from(crawlState.peerNodes.values()).filter(
					(node) => node.overLoaded
				).length
		);

		logger.info(
			'Closed ledgers: ' + crawlState.slots.getClosedSlotIndexes().length
		);
		logger.info(
			Array.from(crawlState.peerNodes.values()).filter(
				(node) => node.suppliedPeerList
			).length + ' supplied us with a peers list.'
		);
	}
}
