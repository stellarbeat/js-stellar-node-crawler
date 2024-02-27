//write tests
import { PeerNodeCollection } from '../src/peer-node-collection';
import { PeerNode } from '../src';
import { NodeInfo } from '@stellarbeat/js-stellar-node-connector/lib/node';

describe('PeerNodeCollection', () => {
	let peerNodeCollection: PeerNodeCollection;

	beforeEach(() => {
		peerNodeCollection = new PeerNodeCollection();
	});

	describe('add', () => {
		it('should add a new peer node', () => {
			const publicKey = 'publicKey';
			const ip = 'localhost';
			const port = 11625;
			const nodeInfo: NodeInfo = {
				overlayVersion: 3,
				overlayMinVersion: 1,
				networkId: 'networkId',
				ledgerVersion: 2,
				versionString: 'versionString'
			};
			const peerNode = peerNodeCollection.addSuccessfullyConnected(
				publicKey,
				ip,
				port,
				nodeInfo
			);
			expect(peerNode).toBeInstanceOf(PeerNode);
			if (peerNode instanceof Error) {
				throw peerNode;
			}
			expect(peerNode.publicKey).toBe(publicKey);
			expect(peerNode.ip).toBe(ip);
			expect(peerNode.port).toBe(port);
			expect(peerNode.nodeInfo).toBe(nodeInfo);
		});

		it('should return an error if the peer node already exists and has already successfully connected', () => {
			const publicKey = 'publicKey';
			const ip = 'localhost';
			const port = 11625;
			const nodeInfo: NodeInfo = {
				overlayVersion: 3,
				overlayMinVersion: 1,
				networkId: 'networkId',
				ledgerVersion: 2,
				versionString: 'versionString'
			};
			peerNodeCollection.addSuccessfullyConnected(
				publicKey,
				ip,
				port,
				nodeInfo
			);
			const peerNode = peerNodeCollection.addSuccessfullyConnected(
				publicKey,
				ip,
				port,
				nodeInfo
			);
			expect(peerNode).toBeInstanceOf(Error);
		});

		it('should update an existing peer node', () => {
			const publicKey = 'publicKey';
			peerNodeCollection.addIfNotExists(publicKey);
			const newIp = 'newIp';
			const newPort = 11626;
			const newNodeInfo: NodeInfo = {
				overlayVersion: 4,
				overlayMinVersion: 2,
				networkId: 'newNetworkId',
				ledgerVersion: 3,
				versionString: 'newVersionString'
			};
			const peerNode = peerNodeCollection.addSuccessfullyConnected(
				publicKey,
				newIp,
				newPort,
				newNodeInfo
			);
			expect(peerNode).toBeInstanceOf(PeerNode);
		});

		it('should return an existing peer node', () => {
			const publicKey = 'publicKey';
			peerNodeCollection.addIfNotExists(publicKey);
			const peerNode = peerNodeCollection.addIfNotExists(publicKey);
			expect(peerNode).toBeInstanceOf(PeerNode);
		});
	});
});
