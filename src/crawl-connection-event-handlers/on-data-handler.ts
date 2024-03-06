import { ConnectionManager, DataPayload } from '../connection-manager';
import { CrawlState } from '../crawl-state';
import { StellarMessageHandler } from '../stellar-message-handlers/stellar-message-handler';
import { P } from 'pino';

export class OnDataHandler {
	constructor(
		private connectionManager: ConnectionManager,
		private stellarMessageHandler: StellarMessageHandler,
		private logger: P.Logger
	) {}
	public onData(data: DataPayload, crawlState: CrawlState): void {
		const result = this.stellarMessageHandler.handleStellarMessage(
			data.publicKey,
			data.stellarMessageWork.stellarMessage,
			crawlState
		);

		data.stellarMessageWork.done();

		if (result.isErr()) {
			this.logger.info({ peer: data.publicKey }, result.error.message);
			this.connectionManager.disconnectByAddress(data.address, result.error);
		}
	}
}
