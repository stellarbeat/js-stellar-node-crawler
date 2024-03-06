import { NodeAddress } from './node-address';
import { CrawlState } from './crawl-state';

export interface CrawlTask {
	nodeAddress: NodeAddress;
	crawlState: CrawlState;
	topTier: boolean;
	connectCallback: () => void;
}
