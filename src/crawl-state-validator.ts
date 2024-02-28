import { MaxOpenConnectionsConfigError } from './error/max-open-connections-config-error';
import { CrawlState } from './crawl-state';
import { CrawlerConfiguration } from './crawler-configuration';
import { err, ok, Result } from 'neverthrow';

export class CrawlStateValidator {
	static validateCrawlState(
		crawlState: CrawlState,
		config: CrawlerConfiguration
	): Result<void, Error> {
		if (config.maxOpenConnections <= crawlState.topTierNodes.size)
			return err(
				new MaxOpenConnectionsConfigError(
					crawlState.topTierNodes.size,
					config.maxOpenConnections
				)
			);
		return ok(undefined);
	}
}
