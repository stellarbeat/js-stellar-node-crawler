import { CrawlerConfiguration } from '../crawler-configuration';
import { NodeConfig } from '@stellarbeat/js-stellar-node-connector/lib/node-config';
import { NodeInfo } from '@stellarbeat/js-stellar-node-connector/lib/node';

export function createDummyCrawlerConfiguration(): CrawlerConfiguration {
	const nodeConfig: NodeConfig = {
		network: 'test',
		nodeInfo: {
			ledgerVersion: 1,
			overlayVersion: 3,
			overlayMinVersion: 2,
			versionString: '1',
			networkId: 'test'
		},
		listeningPort: 11625,
		privateKey: 'secret',
		receiveTransactionMessages: false,
		receiveSCPMessages: true,
		peerFloodReadingCapacity: 100,
		flowControlSendMoreBatchSize: 100,
		peerFloodReadingCapacityBytes: 10000,
		flowControlSendMoreBatchSizeBytes: 10000
	};
	return new CrawlerConfiguration(nodeConfig);
}
