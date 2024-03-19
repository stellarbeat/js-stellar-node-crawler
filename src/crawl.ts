import { AsyncResultCallback } from 'async';
import { NodeAddress } from './node-address';
import { Observation } from './network-observer/observation';

type PeerKey = string; //ip:port

export enum CrawlProcessState {
	IDLE,
	TOP_TIER_SYNC,
	CRAWLING,
	STOPPING
}

export class Crawl {
	state: CrawlProcessState = CrawlProcessState.IDLE;
	maxCrawlTimeHit = false;
	crawlQueueTaskDoneCallbacks: Map<string, AsyncResultCallback<void>> =
		new Map();
	crawledNodeAddresses: Set<PeerKey> = new Set();

	failedConnections: string[] = [];
	peerAddressesReceivedDuringSync: NodeAddress[] = [];

	constructor(
		public nodesToCrawl: NodeAddress[],
		public observation: Observation
	) {}
}
