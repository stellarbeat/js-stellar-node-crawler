import { NodeConfig } from '@stellarbeat/js-stellar-node-connector/lib/node-config';

type PublicKey = string;

export class CrawlerConfiguration {
	constructor(
		public nodeConfig: NodeConfig, //How many connections can be open at the same time. The higher the number, the faster the crawl
		public maxOpenConnections = 25,
		public maxCrawlTime = 1800000, //max nr of ms the crawl will last. Safety guard in case crawler is stuck.
		public blackList = new Set<PublicKey>(),
		public peerStraggleTimeoutMS = 10000 //time in ms that we listen to a node to determine if it is validating a confirmed closed ledger
	) {}
}
