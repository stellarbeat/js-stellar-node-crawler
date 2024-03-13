import { ConnectionManager, DataPayload } from '../connection-manager';
import { NetworkObserverState, SyncState } from '../network-observer';
import { Ledger } from '../../crawler';
import { NodeAddress } from '../../node-address';
import { StellarMessageHandler } from './stellar-message-handlers/stellar-message-handler';
import { P } from 'pino';

export interface OnPeerDataResult {
	closedLedger: Ledger | null;
	peers: Array<NodeAddress>;
}

export class OnPeerData {
	constructor(
		private stellarMessageHandler: StellarMessageHandler,
		private logger: P.Logger,
		private connectionManager: ConnectionManager
	) {}

	public handle(data: DataPayload, syncState: SyncState): OnPeerDataResult {
		const attemptLedgerClose = this.attemptLedgerClose(syncState);
		const result = this.performWork(data, syncState, attemptLedgerClose);

		if (result.isErr()) {
			this.disconnect(data, result.error);
			return this.returnEmpty();
		}

		return this.createOnPeerDataResult(result.value);
	}

	private createOnPeerDataResult(result: {
		closedLedger: Ledger | null;
		peers: Array<NodeAddress>;
	}): OnPeerDataResult {
		return {
			closedLedger: result.closedLedger,
			peers: result.peers
		};
	}

	private performWork(
		data: DataPayload,
		syncState: SyncState,
		attemptLedgerClose: boolean
	) {
		const result = this.stellarMessageHandler.handleStellarMessage(
			data.publicKey,
			data.stellarMessageWork.stellarMessage,
			attemptLedgerClose,
			syncState.crawlState
		);

		data.stellarMessageWork.done();
		return result;
	}

	private attemptLedgerClose(syncState: SyncState) {
		return syncState.state === NetworkObserverState.Synced;
	}

	private returnEmpty() {
		return {
			closedLedger: null,
			peers: []
		};
	}

	private disconnect(data: DataPayload, error: Error) {
		this.logger.info({ peer: data.publicKey }, error.message);
		this.connectionManager.disconnectByAddress(data.address, error);
	}
}
