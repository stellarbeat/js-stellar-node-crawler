import { PeerNodeCollection } from '../../peer-node-collection';
import { listenFurther } from '../listen-further';
import { PeerNode } from '../../peer-node';

describe('listen-further', () => {
	function setupSUT() {
		const peer = new PeerNode('A');
		return { peer };
	}

	describe('top tier node', () => {
		it('should listen further when timeoutCounter is 0, even if crawling is done', () => {
			const { peer } = setupSUT();
			expect(listenFurther(peer, 0, 1, true, true)).toBe(true);
		});
	});

	describe('not top tier node', () => {
		it('should listen further when timeoutCounter is 0', () => {
			const { peer } = setupSUT();
			expect(listenFurther(peer, 0, 1, false, false)).toBe(true);
		});

		it('should not listen further when timeoutCounter reached max', () => {
			const { peer } = setupSUT();
			expect(listenFurther(peer, 1, 1, false, false)).toBe(false);
		});

		it('should not listen further when peer is validating incorrect values', () => {
			const { peer } = setupSUT();
			peer.isValidatingIncorrectValues = true;
			expect(listenFurther(peer, 1, 2, false, false)).toBe(false);
			peer.isValidatingIncorrectValues = false;
		});
	});
});
