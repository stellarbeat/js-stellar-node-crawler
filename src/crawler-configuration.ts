import { NodeConfig } from '@stellarbeat/js-stellar-node-connector/lib/node-config';

type PublicKey = string;

export class CrawlerConfiguration {
	constructor(
		public nodeConfig: NodeConfig, //How many connections can be open at the same time. The higher the number, the faster the crawl
		public maxOpenConnections = 25,
		public maxCrawlTime = 1800000, //max nr of ms the crawl will last. Safety guard in case crawler is stuck.
		public blackList = new Set<PublicKey>()
	) {}
}
