import { PeerNode } from '../peer-node';

describe('PeerNode', () => {
	it('should have a key', () => {
		const peerNode = new PeerNode('publicKey');
		peerNode.ip = 'localhost';
		peerNode.port = 8000;
		expect(peerNode.key).toBe('localhost:8000');
	});

	it('should be successfully connected', () => {
		const peerNode = new PeerNode('publicKey');
		peerNode.connectionTime = new Date();
		expect(peerNode.successfullyConnected).toBe(true);
	});

	describe('processConfirmedLedgerClose', () => {
		test('not externalized', () => {
			const peerNode = new PeerNode('publicKey');
			peerNode.processConfirmedLedgerClose({
				sequence: BigInt(1),
				localCloseTime: new Date(),
				value: 'value',
				closeTime: new Date()
			});
			expect(peerNode.isValidating).toBe(false);
			expect(peerNode.connectedDuringLedgerClose).toBe(false);
			expect(peerNode.isValidatingIncorrectValues).toBe(false);
			expect(peerNode.getMinLagMS()).toBe(undefined);
		});
		test('not yet connected', () => {
			const peerNode = new PeerNode('publicKey');

			const closeTime = new Date('2021-01-01');
			const localCloseTime = new Date('2021-01-02');
			const externalizeTime = new Date('2021-01-03');
			peerNode.addExternalizedValue(BigInt(1), externalizeTime, 'value');

			peerNode.processConfirmedLedgerClose({
				sequence: BigInt(1),
				localCloseTime: localCloseTime,
				value: 'value',
				closeTime: closeTime
			});
			expect(peerNode.isValidating).toBe(true);
			expect(peerNode.connectedDuringLedgerClose).toBe(false);
			expect(peerNode.isValidatingIncorrectValues).toBe(false);
			expect(peerNode.getMinLagMS()).toBe(
				externalizeTime.getTime() - localCloseTime.getTime()
			);
		});

		test('connected during local ledger close', () => {
			const peerNode = new PeerNode('publicKey');
			peerNode.connectionTime = new Date('2021-01-02');

			const closeTime = new Date('2021-01-01');
			const localCloseTime = new Date('2021-01-02');
			const externalizeTime = new Date('2021-01-03');
			peerNode.addExternalizedValue(BigInt(1), externalizeTime, 'value');

			peerNode.processConfirmedLedgerClose({
				sequence: BigInt(1),
				localCloseTime: localCloseTime,
				value: 'value',
				closeTime: closeTime
			});
			expect(peerNode.isValidating).toBe(true);
			expect(peerNode.connectedDuringLedgerClose).toBe(true);
			expect(peerNode.isValidatingIncorrectValues).toBe(false);
			expect(peerNode.getMinLagMS()).toBe(
				externalizeTime.getTime() - localCloseTime.getTime()
			);
		});

		test('connected after local ledger close', () => {
			const peerNode = new PeerNode('publicKey');
			peerNode.connectionTime = new Date('2021-02-02');

			const closeTime = new Date('2021-01-01');
			const localCloseTime = new Date('2021-02-01');
			const externalizeTime = new Date('2021-03-01');
			peerNode.addExternalizedValue(BigInt(1), externalizeTime, 'value');

			peerNode.processConfirmedLedgerClose({
				sequence: BigInt(1),
				localCloseTime: localCloseTime,
				value: 'value',
				closeTime: closeTime
			});
			expect(peerNode.isValidating).toBe(true);
			expect(peerNode.connectedDuringLedgerClose).toBe(false);
			expect(peerNode.isValidatingIncorrectValues).toBe(false);
			expect(peerNode.getMinLagMS()).toBe(
				externalizeTime.getTime() - localCloseTime.getTime()
			);
		});

		test('disconnected before local ledger close', () => {
			const peerNode = new PeerNode('publicKey');
			peerNode.connectionTime = new Date('2021-01-01');
			peerNode.disconnectionTime = new Date('2021-01-02');

			const closeTime = new Date('2021-01-01');
			const localCloseTime = new Date('2021-01-03');
			const externalizeTime = new Date('2021-01-05');
			peerNode.addExternalizedValue(BigInt(1), externalizeTime, 'value');

			peerNode.processConfirmedLedgerClose({
				sequence: BigInt(1),
				localCloseTime: localCloseTime,
				value: 'value',
				closeTime: closeTime
			});
			expect(peerNode.isValidating).toBe(true);
			expect(peerNode.connectedDuringLedgerClose).toBe(false);
			expect(peerNode.isValidatingIncorrectValues).toBe(false);
			expect(peerNode.getMinLagMS()).toBe(
				externalizeTime.getTime() - localCloseTime.getTime()
			);
		});

		test('disconnected after local ledger close', () => {
			const peerNode = new PeerNode('publicKey');
			peerNode.connectionTime = new Date('2021-01-01');
			peerNode.disconnectionTime = new Date('2021-01-07');

			const closeTime = new Date('2021-01-01');
			const localCloseTime = new Date('2021-01-03');
			const externalizeTime = new Date('2021-01-05');
			peerNode.addExternalizedValue(BigInt(1), externalizeTime, 'value');

			peerNode.processConfirmedLedgerClose({
				sequence: BigInt(1),
				localCloseTime: localCloseTime,
				value: 'value',
				closeTime: closeTime
			});
			expect(peerNode.isValidating).toBe(true);
			expect(peerNode.connectedDuringLedgerClose).toBe(true);
			expect(peerNode.isValidatingIncorrectValues).toBe(false);
			expect(peerNode.getMinLagMS()).toBe(
				externalizeTime.getTime() - localCloseTime.getTime()
			);
		});
		test('disconnected after externalize', () => {
			const peerNode = new PeerNode('publicKey');
			peerNode.connectionTime = new Date('2021-01-01');
			peerNode.disconnectionTime = new Date('2021-01-05');

			const closeTime = new Date('2021-01-01');
			const localCloseTime = new Date('2021-01-03');
			const externalizeTime = new Date('2021-01-02');
			peerNode.addExternalizedValue(BigInt(1), externalizeTime, 'value');

			peerNode.processConfirmedLedgerClose({
				sequence: BigInt(1),
				localCloseTime: localCloseTime,
				value: 'value',
				closeTime: closeTime
			});
			expect(peerNode.isValidating).toBe(true);
			expect(peerNode.connectedDuringLedgerClose).toBe(true);
			expect(peerNode.isValidatingIncorrectValues).toBe(false);
			expect(peerNode.getMinLagMS()).toBe(
				externalizeTime.getTime() - localCloseTime.getTime()
			);
		});

		test('disconnected before externalize', () => {
			const peerNode = new PeerNode('publicKey');
			peerNode.connectionTime = new Date('2021-01-01');
			peerNode.disconnectionTime = new Date('2021-01-04');

			const closeTime = new Date('2021-01-01');
			const localCloseTime = new Date('2021-01-03');
			const externalizeTime = new Date('2021-01-05');
			peerNode.addExternalizedValue(BigInt(1), externalizeTime, 'value');

			peerNode.processConfirmedLedgerClose({
				sequence: BigInt(1),
				localCloseTime: localCloseTime,
				value: 'value',
				closeTime: closeTime
			});
			expect(peerNode.isValidating).toBe(true);
			expect(peerNode.connectedDuringLedgerClose).toBe(false);
			expect(peerNode.isValidatingIncorrectValues).toBe(false);
			expect(peerNode.getMinLagMS()).toBe(
				externalizeTime.getTime() - localCloseTime.getTime()
			);
		});

		test('invalid value', () => {
			const peerNode = new PeerNode('publicKey');
			peerNode.connectionTime = new Date('2021-02-02');

			const closeTime = new Date('2021-01-01');
			const localCloseTime = new Date('2021-02-01');
			const externalizeTime = new Date('2021-03-01');
			peerNode.addExternalizedValue(BigInt(1), externalizeTime, 'value');

			peerNode.processConfirmedLedgerClose({
				sequence: BigInt(1),
				localCloseTime: localCloseTime,
				value: 'invalidValue',
				closeTime: closeTime
			});
			expect(peerNode.isValidating).toBe(false);
			expect(peerNode.connectedDuringLedgerClose).toBe(false);
			expect(peerNode.isValidatingIncorrectValues).toBe(true);
			expect(peerNode.getMinLagMS()).toBe(undefined);
		});
	});
});
