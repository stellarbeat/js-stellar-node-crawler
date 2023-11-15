import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { Slot } from '../src/slot';
import { Keypair, xdr } from 'stellar-base';

describe('Slot', () => {
	describe('registerStatement', () => {
		const keypair = Keypair.random();
		const quorumSet = new QuorumSet(1, [keypair.publicKey()]);
		it('should register externalize envelope', () => {
			const slot = new Slot(BigInt(1), quorumSet);
			const statement = new xdr.ScpStatement({
				nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
				slotIndex: xdr.Uint64.fromString('1'),
				pledges: xdr.ScpStatementPledges.scpStExternalize(
					new xdr.ScpStatementExternalize({
						commit: new xdr.ScpBallot({ counter: 1, value: Buffer.alloc(32) }),
						nH: 1,
						commitQuorumSetHash: Buffer.alloc(32)
					})
				)
			});
			slot.registerStatement(keypair.publicKey(), statement);

			expect(slot.getStatement(keypair.publicKey())).toBeInstanceOf(
				xdr.ScpStatement
			);
		});

		it('should register confirm envelope', () => {
			const slot = new Slot(BigInt(1), quorumSet);
			const statement = new xdr.ScpStatement({
				nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
				slotIndex: xdr.Uint64.fromString('1'),
				pledges: xdr.ScpStatementPledges.scpStConfirm(
					new xdr.ScpStatementConfirm({
						ballot: new xdr.ScpBallot({ counter: 1, value: Buffer.alloc(32) }),
						nPrepared: 1,
						nCommit: 1,
						nH: 1,
						quorumSetHash: Buffer.alloc(32)
					})
				)
			});
			slot.registerStatement(keypair.publicKey(), statement);

			expect(slot.getStatement(keypair.publicKey())).toBeInstanceOf(
				xdr.ScpStatement
			);
		});

		it('should not register older envelope', () => {
			const slot = new Slot(BigInt(1), quorumSet);
			const statement = new xdr.ScpStatement({
				nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
				slotIndex: xdr.Uint64.fromString('1'),
				pledges: xdr.ScpStatementPledges.scpStExternalize(
					new xdr.ScpStatementExternalize({
						commit: new xdr.ScpBallot({ counter: 1, value: Buffer.alloc(32) }),
						nH: 1,
						commitQuorumSetHash: Buffer.alloc(32)
					})
				)
			});
			slot.registerStatement(keypair.publicKey(), statement);

			const olderStatement = new xdr.ScpStatement({
				nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
				slotIndex: xdr.Uint64.fromString('1'),
				pledges: xdr.ScpStatementPledges.scpStConfirm(
					new xdr.ScpStatementConfirm({
						ballot: new xdr.ScpBallot({ counter: 1, value: Buffer.alloc(32) }),
						nPrepared: 1,
						nCommit: 1,
						nH: 1,
						quorumSetHash: Buffer.alloc(32)
					})
				)
			});
			slot.registerStatement(keypair.publicKey(), olderStatement);

			expect(slot.getStatement(keypair.publicKey())!.pledges().switch()).toBe(
				xdr.ScpStatementType.scpStExternalize()
			);
		});

		it('should not register envelope from untrusted node', () => {
			const slot = new Slot(BigInt(1), quorumSet);
			const otherKeyPair = Keypair.random();
			const statement = new xdr.ScpStatement({
				nodeId: xdr.PublicKey.publicKeyTypeEd25519(otherKeyPair.rawPublicKey()),
				slotIndex: xdr.Uint64.fromString('1'),
				pledges: xdr.ScpStatementPledges.scpStExternalize(
					new xdr.ScpStatementExternalize({
						commit: new xdr.ScpBallot({ counter: 1, value: Buffer.alloc(32) }),
						nH: 1,
						commitQuorumSetHash: Buffer.alloc(32)
					})
				)
			});
			slot.registerStatement(otherKeyPair.publicKey(), statement);

			expect(slot.getStatement(otherKeyPair.publicKey())).toBeUndefined();
		});

		it('should not register prepare or nominate messages', () => {
			const slot = new Slot(BigInt(1), quorumSet);
			const prepare = new xdr.ScpStatement({
				nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
				slotIndex: xdr.Uint64.fromString('1'),
				pledges: xdr.ScpStatementPledges.scpStPrepare(
					new xdr.ScpStatementPrepare({
						ballot: new xdr.ScpBallot({ counter: 1, value: Buffer.alloc(32) }),
						prepared: new xdr.ScpBallot({
							counter: 1,
							value: Buffer.alloc(32)
						}),
						preparedPrime: new xdr.ScpBallot({
							counter: 1,
							value: Buffer.alloc(32)
						}),
						nC: 1,
						nH: 1,
						quorumSetHash: Buffer.alloc(32)
					})
				)
			});

			const nominate = new xdr.ScpStatement({
				nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
				slotIndex: xdr.Uint64.fromString('1'),
				pledges: xdr.ScpStatementPledges.scpStNominate(
					new xdr.ScpNomination({
						quorumSetHash: Buffer.alloc(32),
						votes: [],
						accepted: []
					})
				)
			});

			slot.registerStatement(keypair.publicKey(), prepare);
			slot.registerStatement(keypair.publicKey(), nominate);

			expect(slot.getStatement(keypair.publicKey())).toBeUndefined();
		});
	});
});
