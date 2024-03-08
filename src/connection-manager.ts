import { EventEmitter } from 'events';
import {
	Connection,
	Node as NetworkNode
} from '@stellarbeat/js-stellar-node-connector';
import { P } from 'pino';
import { truncate } from './utilities/truncate';
import { StellarMessageWork } from '@stellarbeat/js-stellar-node-connector/lib/connection/connection';
import { NodeInfo } from '@stellarbeat/js-stellar-node-connector/lib/node';

type PublicKey = string;
type Address = string;

export interface ConnectedPayload {
	publicKey: PublicKey;
	ip: string;
	port: number;
	nodeInfo: NodeInfo;
}

export interface DataPayload {
	address: Address;
	stellarMessageWork: StellarMessageWork;
	publicKey: PublicKey;
}

export interface ClosePayload {
	address: string;
	publicKey?: PublicKey;
}

export class ConnectionManager extends EventEmitter {
	private activeConnections: Map<string, Connection>;

	constructor(
		private node: NetworkNode,
		private blackList: Set<PublicKey>,
		private logger: P.Logger
	) {
		super();
		this.activeConnections = new Map(); // Active connections keyed by node public key or address
	}

	/**
	 * Connects to a node at the specified IP and port.
	 * @param {string} ip The IP address of the node.
	 * @param {number} port The port number of the node.
	 */
	connectToNode(ip: string, port: number) {
		const address = `${ip}:${port}`;
		const connection = this.node.connectTo(ip, port);
		this.logger.debug({ peer: connection.remoteAddress }, 'Connecting');

		// Setup event listeners for the connection
		connection.on('connect', (publicKey, nodeInfo) => {
			this.logger.trace('Connect event received');
			if (this.blackList.has(publicKey)) {
				this.logger.debug({ peer: connection.remoteAddress }, 'Blacklisted');
				this.disconnect(connection);
				return;
			}
			this.logger.debug(
				{
					pk: truncate(publicKey),
					peer: connection.remoteAddress,
					local: connection.localAddress
				},
				'Connected'
			);
			this.activeConnections.set(address, connection);
			connection.remotePublicKey = publicKey;
			this.emit('connected', { publicKey, ip, port, nodeInfo });
		});

		connection.on('error', (error) => {
			this.logger.debug(`Connection error with ${address}: ${error.message}`);
			this.disconnect(connection, error);
		});

		connection.on('timeout', () => {
			this.logger.debug(`Connection timeout for ${address}`);
			this.disconnect(connection);
		});

		connection.on('close', (hadError: boolean) => {
			this.logger.debug(
				{
					pk: truncate(connection.remotePublicKey),
					peer: connection.remoteAddress,
					hadError: hadError,
					local: connection.localAddress
				},
				'Node connection closed'
			);
			this.activeConnections.delete(address);
			const closePayload: ClosePayload = {
				address,
				publicKey: connection.remotePublicKey
			};
			this.emit('close', closePayload);
		});

		connection.on('data', (stellarMessageWork: StellarMessageWork) => {
			if (!connection.remotePublicKey) {
				this.logger.error(`Received data from unknown peer ${address}`);
				return;
			}
			this.emit('data', {
				address,
				publicKey: connection.remotePublicKey,
				stellarMessageWork
			});
		});
	}

	private disconnect(connection: Connection, error?: Error): void {
		if (error) {
			this.logger.debug(
				{
					peer: connection.remoteAddress,
					pk: truncate(connection.remotePublicKey),
					error: error.message
				},
				'Disconnecting'
			);
		} else {
			this.logger.trace(
				{
					peer: connection.remoteAddress,
					pk: truncate(connection.remotePublicKey)
				},
				'Disconnecting'
			);
		}

		connection.destroy();
	}

	/*public broadcast(stellarMessage: xdr.StellarMessage, doNotSendTo: Set<Address>) {

	}*/

	public disconnectByAddress(address: Address, error?: Error): void {
		const connection = this.activeConnections.get(address);
		if (!connection) {
			return;
		}
		this.disconnect(connection, error);
	}

	getActiveConnection(address: Address) {
		return this.activeConnections.get(address);
	}

	getActiveConnectionAddresses(): string[] {
		return Array.from(this.activeConnections.keys());
	}

	hasActiveConnectionTo(address: Address) {
		return this.activeConnections.has(address);
	}

	getNumberOfActiveConnections() {
		return this.activeConnections.size;
	}

	/**
	 * Shuts down the connection manager, closing all active connections.
	 */
	shutdown() {
		this.activeConnections.forEach((connection) => {
			this.disconnect(connection);
		}); //what about the in progress connections
		this.logger.info('ConnectionManager shutdown: All connections closed.', {
			activeConnections: this.activeConnections.size
		});
	}
}
