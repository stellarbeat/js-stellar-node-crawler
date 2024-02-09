import { MaxOpenConnectionsConfigError } from './error/max-open-connections-config-error';
import { CrawlState } from './crawl-state';
import { CrawlerConfiguration } from './crawler-configuration';

export class CrawlStateValidator {
	static validateCrawlState(
		crawlState: CrawlState,
		config: CrawlerConfiguration
	): Error | null {
		if (config.maxOpenConnections <= crawlState.topTierNodes.size)
			return new MaxOpenConnectionsConfigError(
				crawlState.topTierNodes.size,
				config.maxOpenConnections
			);

		return null;
	}
}