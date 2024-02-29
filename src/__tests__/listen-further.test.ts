import { PeerNodeCollection } from '../peer-node-collection';
import { listenFurther } from '../listen-further';

describe('listen-further', () => {
	function setupSUT() {
		const peerNodes = new PeerNodeCollection();
		const peer = peerNodes.getOrAdd('A');
		const otherPeer = peerNodes.getOrAdd('B');
		const topTierNodes = new Set<string>();
		topTierNodes.add('A');
		return { peer, otherPeer, peerNodes, topTierNodes };
	}

	it('should listen further when timeoutCounter is 0', () => {
		const { peer, peerNodes, topTierNodes } = setupSUT();
		expect(listenFurther(peer, 0, 1, topTierNodes, true, peerNodes)).toBe(true);
	});

	it('should not listen further when timeoutCounter reached max', () => {
		const { peer, otherPeer, peerNodes, topTierNodes } = setupSUT();
		expect(listenFurther(peer, 1, 1, topTierNodes, true, peerNodes)).toBe(
			false
		);
	});

	it('should not listen further when peer is validating incorrect values', () => {
		const { peer, otherPeer, peerNodes, topTierNodes } = setupSUT();
		peer.isValidatingIncorrectValues = true;
		expect(listenFurther(peer, 1, 2, topTierNodes, true, peerNodes)).toBe(
			false
		);
		peer.isValidatingIncorrectValues = false;
	});

	it('should not listen further when peer is not participating in SCP and not a top tier node', () => {
		const { peer, otherPeer, peerNodes, topTierNodes } = setupSUT();
		otherPeer.isValidating = false;
		expect(listenFurther(otherPeer, 1, 2, topTierNodes, true, peerNodes)).toBe(
			false
		);
	});

	it('should not listen further when peer is not participating in SCP and peer is a top tier node', () => {
		const { peer, otherPeer, peerNodes, topTierNodes } = setupSUT();
		peer.isValidating = false;
		expect(listenFurther(otherPeer, 1, 2, topTierNodes, true, peerNodes)).toBe(
			false
		);
	});

	it('should listen further when peer is participating in SCP and not a top tier node', () => {
		const { peer, otherPeer, peerNodes, topTierNodes } = setupSUT();
		otherPeer.isValidating = false;
		otherPeer.participatingInSCP = true;
		expect(listenFurther(otherPeer, 1, 2, topTierNodes, true, peerNodes)).toBe(
			true
		);
	});

	it('should listen further when peer is validating and not yet has a quorumSet and is not a top tier node', () => {
		const { peer, otherPeer, peerNodes, topTierNodes } = setupSUT();
		otherPeer.participatingInSCP = true;
		otherPeer.isValidating = true;
		otherPeer.quorumSet = undefined;
		expect(listenFurther(otherPeer, 1, 2, topTierNodes, false, peerNodes)).toBe(
			true
		);
	});

	it('should not listen further when peer is validating and has a quorumSet and is not a top tier node', () => {
		const { peer, otherPeer, peerNodes, topTierNodes } = setupSUT();
		expect(listenFurther(otherPeer, 1, 2, topTierNodes, false, peerNodes)).toBe(
			false
		);
	});

	it('should listen further when queue is not empty', () => {
		const { peer, otherPeer, peerNodes, topTierNodes } = setupSUT();
		expect(listenFurther(peer, 1, 2, topTierNodes, false, peerNodes)).toBe(
			true
		);
	});

	it('should not listen further when queue is empty and top tier nodes are participating in SCP and validating', () => {
		const { peer, otherPeer, peerNodes, topTierNodes } = setupSUT();
		peer.isValidating = true;
		peer.participatingInSCP = true;
		const otherTopTierNode = peerNodes.getOrAdd('C');
		otherTopTierNode.isValidating = true;
		otherTopTierNode.participatingInSCP = true;
		topTierNodes.add('C');
		expect(listenFurther(peer, 1, 2, topTierNodes, true, peerNodes)).toBe(
			false
		);
	});

	it('should listen further when queue is empty and some top tier nodes are participating in SCP and not validating', () => {
		const { peer, otherPeer, peerNodes, topTierNodes } = setupSUT();
		peer.isValidating = false;
		peer.latestActiveSlotIndex = '1';
		const otherTopTierNode = peerNodes.getOrAdd('C');
		otherTopTierNode.isValidating = true;
		otherTopTierNode.latestActiveSlotIndex = '1';
		topTierNodes.add('C');
		expect(listenFurther(peer, 1, 2, topTierNodes, true, peerNodes)).toBe(true);
	});
});
