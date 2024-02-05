import { PeerNode } from './peer-node';
import { Ledger } from './crawler';

export interface CrawlResult {
	peers: Map<string, PeerNode>;
	closedLedgers: bigint[];
	latestClosedLedger: Ledger;
}
