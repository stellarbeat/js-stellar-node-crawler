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
import { Slots } from '../slots';
import { CachedLedgerCloseScpEnvelopeHandler } from './cached-ledger-close-scp-envelope-handler';

export class LedgerCloseDetector extends EventEmitter {
	private trustedPublicKeys: Set<PublicKey> = new Set();
	private _slots: Slots | null = null;

	constructor(
		private connectionManager: ConnectionManager,
		private scpMessageHandler: CachedLedgerCloseScpEnvelopeHandler, //todo: interface
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
		this._slots = new Slots(trustedQuorumSet, this.logger);

		addresses.forEach((address) => {
			this.connectionManager.connectToNode(address[0], address[1]);
		});
	}

	get slots(): Slots {
		if (!this._slots) throw new Error('Slots not initialized yet.');
		return this._slots;
	}

	//other nodes can help in determining consensus.
	//this is needed in scenarios where all top tier nodes are overloaded,
	// but some nodes are still connected and receiving/relaying scp messages from top tier.
	//however lag detection will be flaky then, should indicate with a warning!
	public processScpEnvelope(sender: PublicKey, scpEnvelope: xdr.ScpEnvelope) {
		this.handleScpEnvelope(sender, scpEnvelope);
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
				this.handleScpEnvelope(data.publicKey, stellarMessage.envelope());
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

	private handleScpEnvelope(sender: PublicKey, scpEnvelope: xdr.ScpEnvelope) {
		const ledgerOrUndefined = this.scpMessageHandler.handleScpEnvelope(
			this.slots,
			scpEnvelope,
			this.networkHash
		);
		if (ledgerOrUndefined.isErr()) {
			this.logger.info(
				{
					sender: truncate(sender),
					error: ledgerOrUndefined.error.message
				},
				'Error processing SCP envelope'
			);
			return;
		}

		if (ledgerOrUndefined.value !== undefined) {
			this.logger.info(
				{
					ledger: ledgerOrUndefined.value.sequence,
					closeTime: ledgerOrUndefined.value.closeTime,
					localCloseTime: ledgerOrUndefined.value.localCloseTime,
					value: truncate(ledgerOrUndefined.value.value)
				},
				'Ledger closed'
			);
			this.emit('ledgerClosed', ledgerOrUndefined.value);
		}
	}

	private onConnectionClose(address: string, publicKey: string) {
		this.logger.debug(`Connection to ${publicKey} at ${address} closed.`);
	}

	public getConnectedNodesCount(): number {
		return this.connectionManager.getNumberOfActiveConnections();
	}

	stop() {
		this.logger.info('Stopping top tier ledger close detector.');
		this.connectionManager.shutdown();
	}
}
