import { EventEmitter } from 'events';
import pino from 'pino';
import Logger = pino.Logger;
import {
	ClosePayload,
	ConnectedPayload,
	ConnectionManager,
	DataPayload
} from '../connection-manager';
import { PublicKey, QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { NodeAddress } from '../crawler';
import { xdr } from '@stellar/stellar-base';
import { truncate } from '../truncate';
import { LedgerCloseScpEnvelopeHandler } from './ledger-close-scp-envelope-handler';

export class LedgerCloseDetector extends EventEmitter {
	private trustedPublicKeys: Set<PublicKey> = new Set();

	constructor(
		private connectionManager: ConnectionManager,
		private scpMessageHandler: LedgerCloseScpEnvelopeHandler,
		private networkHash: Buffer,
		private logger: Logger
	) {
		super();
		this.logger = logger.child({ mod: 'LedgerCloseDetector' });
		this.setupConnectionManagerEvents();
	}

	start(
		addresses: NodeAddress[], //it's a seed because IPs could have changed since last run.
		trustedQuorumSet: QuorumSet
	) {
		this.logger.info('Starting ledger close detector.');
		this.setTrustedPublicKeys(trustedQuorumSet);

		addresses.forEach((address) => {
			this.connectionManager.connectToNode(address[0], address[1]);
		});
	}

	//other nodes can help in determining consensus.
	//this is needed in scenarios where all top tier nodes are overloaded,
	// but some nodes are still connected and receiving/relaying scp messages from top tier.
	//however lag detection will be flakey then, should indicate with a warning!
	public processStellarMessage(data: DataPayload) {
		this.onStellarMessage(data);
	}

	//public getValidationStateOfTrustedNodes(): Map<PublicKey, Record<>, any> {}

	private setTrustedPublicKeys(trustedQuorumSet: QuorumSet) {
		this.trustedPublicKeys = new Set(
			QuorumSet.getAllValidators(trustedQuorumSet).map((validator) =>
				validator.toString()
			)
		);
	}

	private setupConnectionManagerEvents() {
		this.connectionManager.on('connected', (data: ConnectedPayload) => {
			this.onConnected(data.ip, data.port, data.publicKey);
		});
		this.connectionManager.on('data', (data: DataPayload) => {
			this.onStellarMessage(data);
		});
		this.connectionManager.on('close', (data: ClosePayload) => {
			this.onConnectionClose(data.address, data.publicKey);
		});
	}

	private onConnected(ip: string, port: number, publicKey: string) {
		this.logger.info(
			`Connected to top tier node ${publicKey} at ${ip}:${port}.`
		);

		if (!this.trustedPublicKeys.has(publicKey)) {
			this.logger.warn(
				`Connected to non-trusted node ${publicKey} at ${ip}:${port}.`
			);
		}
	}

	private onStellarMessage(data: DataPayload) {
		const stellarMessage = data.stellarMessageWork.stellarMessage;
		this.logger.debug(
			'Received stellar message of type ' + stellarMessage.switch().name
		);
		switch (stellarMessage.switch()) {
			case xdr.MessageType.scpMessage():
				this.handleScpEnvelope(data, stellarMessage.envelope());
				break;
			case xdr.MessageType.errorMsg():
				this.logger.info(
					{
						pk: truncate(data.publicKey),
						error: stellarMessage.error().code().name,
						msg: stellarMessage.error().msg().toString()
					},
					'Error message received from trusted node'
				);
				break;
			default:
				this.logger.debug(
					{ type: stellarMessage.switch().name },
					'Unhandled Stellar message type'
				);
				break;
		}

		data.stellarMessageWork.done();
	}

	private handleScpEnvelope(data: DataPayload, scpEnvelope: xdr.ScpEnvelope) {
		const ledgerOrUndefined = this.scpMessageHandler.handleScpEnvelope(
			scpEnvelope,
			this.networkHash
		);
		if (ledgerOrUndefined.isErr()) {
			this.logger.info(
				{
					pk: truncate(data.publicKey),
					error: ledgerOrUndefined.error.message
				},
				'Error processing SCP envelope'
			);
			return;
		}

		if (ledgerOrUndefined.value !== undefined) {
			this.emit('ledgerClose', ledgerOrUndefined.value);
		}
	}

	private onConnectionClose(address: string, publicKey: string) {
		this.logger.info(`Connection to ${publicKey} at ${address} closed.`);
	}

	stop() {
		this.logger.info('Stopping top tier ledger close detector.');
		this.connectionManager.shutdown();
	}
}
