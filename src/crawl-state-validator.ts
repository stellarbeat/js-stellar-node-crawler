import { CrawlState } from './crawl-state';
import { CrawlerConfiguration } from './crawler-configuration';
import { err, ok, Result } from 'neverthrow';
import { MaxOpenConnectionsConfigError } from './errors/max-open-connections-config-error';

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
