// connectionManager.test.ts

import { mock, mockDeep, MockProxy } from 'jest-mock-extended';
import {
	Node as NetworkNode,
	Connection
} from '@stellarbeat/js-stellar-node-connector';
import { ConnectionManager } from '../connection-manager';
import { P } from 'pino';
import { EventEmitter } from 'events';

describe('ConnectionManager', () => {
	let mockNode: MockProxy<NetworkNode>;
	let mockLogger: MockProxy<P.Logger>;
	let connectionManager: ConnectionManager;
	const mockConnection = mockDeep<Connection>();
	const ip = '127.0.0.1';
	const port = 8001;
	const testAddress = ip + ':' + port;
	const testPublicKey = 'GABCD1234TEST';
	const nodeInfo = {}; // Simplified for example

	beforeEach(() => {
		jest.clearAllMocks();
		mockNode = mock<NetworkNode>();
		mockLogger = mock<P.Logger>();
		connectionManager = new ConnectionManager(mockNode, new Set(), mockLogger);
		// Manual implementation to handle event listeners and emitting
		const realEmitter = new EventEmitter();

		// Intercept the `.on` and `.addListener` calls to attach listeners to the real EventEmitter
		mockConnection.on.mockImplementation((event, listener) => {
			realEmitter.on(event, listener);
			return mockConnection;
		});

		mockConnection.addListener.mockImplementation((event, listener) => {
			realEmitter.addListener(event, listener);
			return mockConnection;
		});

		mockConnection.emit.mockImplementation((event, ...args): boolean => {
			return realEmitter.emit(event, ...args);
		});

		// Mock the connectTo method to return a mocked connection object
		mockNode.connectTo.mockReturnValue(mockConnection);
	});

	it('should connect to a node and emit "connected" event', () => {
		const connectListener = jest.fn();
		connectionManager.on('connected', connectListener);
		connectionManager.connectToNode('127.0.0.1', 8001);
		mockConnection.emit('connect', testPublicKey, nodeInfo);

		expect(connectListener).toHaveBeenCalledWith({
			publicKey: testPublicKey,
			ip: '127.0.0.1',
			port: 8001,
			nodeInfo
		});
		expect(connectionManager.hasActiveConnectionTo(testAddress)).toBeTruthy();
		expect(connectionManager.getActiveConnectionAddresses()).toEqual([
			testAddress
		]);
		expect(connectionManager.getNumberOfActiveConnections()).toEqual(1);
		expect(connectionManager.getActiveConnection(testAddress)).toEqual(
			mockConnection
		);
	});

	it('should close connection with blacklisted node', () => {
		connectionManager = new ConnectionManager(
			mockNode,
			new Set([testPublicKey]),
			mockLogger
		);
		const connectListener = jest.fn();
		connectionManager.on('connected', connectListener);
		connectionManager.connectToNode('127.0.0.1', 8001);
		mockConnection.emit('connect', testPublicKey, nodeInfo);

		expect(connectListener).toHaveBeenCalledTimes(0);
		expect(connectionManager.getNumberOfActiveConnections()).toEqual(0);
	});

	it('disconnects on connection error', () => {
		connectionManager.connectToNode('127.0.0.1', 8001);
		const error = new Error('Connection error');
		mockConnection.emit('error', error);

		expect(mockLogger.debug).toHaveBeenCalled();
		expect(mockConnection.destroy).toHaveBeenCalled();
	});

	it('should shutdown and close all active connections', async () => {
		// Simulate a successful connection
		connectionManager.connectToNode('127.0.0.1', 8001);
		connectionManager.connectToNode('127.0.0.1', 8002);
		mockConnection.emit('connect', testPublicKey, nodeInfo);
		mockConnection.emit('connect', 'OTHER', nodeInfo);

		connectionManager.shutdown();

		expect(mockConnection.destroy).toHaveBeenCalledTimes(2);
	});

	it('should disconnect', () => {
		connectionManager.connectToNode('127.0.0.1', 8001);
		connectionManager.connectToNode('127.0.0.1', 8002);
		mockConnection.emit('connect', testPublicKey, nodeInfo);
		mockConnection.emit('connect', 'OTHER', nodeInfo);
		connectionManager.disconnectByAddress(testAddress);
		expect(mockConnection.destroy).toHaveBeenCalledTimes(1);
	});

	it('should not disconnect if connection does not exist', () => {
		connectionManager.connectToNode('127.0.0.1', 8001);
		mockConnection.emit('connect', testPublicKey, nodeInfo);
		connectionManager.disconnectByAddress('127.0.0.1:8002');
		expect(mockConnection.destroy).toHaveBeenCalledTimes(0);
	});

	it('should handle connection close event', () => {
		connectionManager.connectToNode('127.0.0.1', 8001);
		mockConnection.emit('connect', testPublicKey, nodeInfo);
		mockConnection.emit('close');
		expect(connectionManager.getNumberOfActiveConnections()).toEqual(0);
	});

	it('should disconnect on timeout', () => {
		connectionManager.connectToNode('127.0.0.1', 8001);
		mockConnection.emit('connect', testPublicKey, nodeInfo);
		mockConnection.emit('timeout');
		expect(mockConnection.destroy).toHaveBeenCalledTimes(1);
	});

	it('should emit data event on data received', () => {
		const dataListener = jest.fn();
		connectionManager.on('data', dataListener);
		connectionManager.connectToNode('127.0.0.1', 8001);
		mockConnection.emit('connect', testPublicKey, nodeInfo);
		mockConnection.emit('data', { content: 'test' });

		expect(dataListener).toHaveBeenCalledWith({
			address: '127.0.0.1:8001',
			publicKey: 'GABCD1234TEST',
			stellarMessageWork: {
				content: 'test'
			}
		});
	});

	it('should not emit data event if remote public key is missing', () => {
		const dataListener = jest.fn();
		connectionManager.on('data', dataListener);
		connectionManager.connectToNode('127.0.0.1', 8001);
		mockConnection.remotePublicKey = undefined;
		mockConnection.emit('data', { content: 'test' });

		expect(dataListener).toHaveBeenCalledTimes(0);
	});
});
