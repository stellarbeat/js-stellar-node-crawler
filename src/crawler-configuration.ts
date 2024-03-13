import { NodeConfig } from '@stellarbeat/js-stellar-node-connector/lib/node-config';

type PublicKey = string;

export class CrawlerConfiguration {
	constructor(
		public nodeConfig: NodeConfig, //How many connections can be open at the same time. The higher the number, the faster the crawl
		public maxOpenConnections = 25, //How many (non-top tier) peer connections can be open at the same time. The higher the number, the faster the crawl, but the more risk of higher latencies
		public maxCrawlTime = 1800000, //max nr of ms the crawl will last. Safety guard in case crawler is stuck.
		public blackList = new Set<PublicKey>(), //nodes that are not crawled
		public peerStraggleTimeoutMS = 10000, //time in ms that we listen to a node to determine if it is validating a confirmed closed ledger
		public syncingTimeoutMS = 10000, //time in ms that the network observer waits for the top tiers to sync
		public quorumSetRequestTimeoutMS = 1500, //time in ms that we wait for a quorum set to be received from a single peer
		public consensusTimeoutMS = 90000 //time in ms before we declare the network stuck.
	) {}
}
