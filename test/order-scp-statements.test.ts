import {Keypair, xdr} from "stellar-base";
import {isNewerConsensusStatement} from "../src/order-scp-statements";

describe('order-scp-statements', () => {
    describe('isNewerConsensusStatement', () => {
        it('should return true if statementToCheck is externalize', () => {
            const keypair = Keypair.random();

            const statementToCheck = new xdr.ScpStatement({
                nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                slotIndex: xdr.Uint64.fromString('1'),
                pledges: xdr.ScpStatementPledges.scpStExternalize(new xdr.ScpStatementExternalize({
                    commit: new xdr.ScpBallot({counter: 1, value: Buffer.alloc(32)}),
                    nH: 1,
                    commitQuorumSetHash: Buffer.alloc(32)
                }))
            });

            const originalStatement = new xdr.ScpStatement({
                nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                slotIndex: xdr.Uint64.fromString('1'),
                pledges: xdr.ScpStatementPledges.scpStExternalize(new xdr.ScpStatementExternalize({
                    commit: new xdr.ScpBallot({counter: 2, value: Buffer.alloc(32)}),
                    nH: 1,
                    commitQuorumSetHash: Buffer.alloc(32)
                }))
            });

            expect(isNewerConsensusStatement(statementToCheck, originalStatement)).toBe(true);
        });

        it('should return false if statementToCheck is a nominate message', function () {
            const statementToCheck = new xdr.ScpStatement({
                nodeId: xdr.PublicKey.publicKeyTypeEd25519(Keypair.random().rawPublicKey()),
                slotIndex: xdr.Uint64.fromString('1'),
                pledges: xdr.ScpStatementPledges.scpStNominate(new xdr.ScpNomination({
                    quorumSetHash: Buffer.alloc(32),
                    votes: [],
                    accepted: []
                }))
            });

            expect(isNewerConsensusStatement(statementToCheck, undefined)).toBe(false);
        });

        it('should return false if statementToCheck is a prepare message and originalStatement is externalize', function () {
            const keypair = Keypair.random();

            const statementToCheck = new xdr.ScpStatement({
                nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                slotIndex: xdr.Uint64.fromString('1'),
                pledges: xdr.ScpStatementPledges.scpStPrepare(new xdr.ScpStatementPrepare({
                    ballot: new xdr.ScpBallot({counter: 1, value: Buffer.alloc(32)}),
                    prepared: new xdr.ScpBallot({counter: 1, value: Buffer.alloc(32)}),
                    preparedPrime: new xdr.ScpBallot({counter: 1, value: Buffer.alloc(32)}),
                    nC: 1,
                    nH: 1,
                    quorumSetHash: Buffer.alloc(32)
                }))
            });

            expect(isNewerConsensusStatement(statementToCheck, undefined)).toBe(false);
        });

        it('should return true if statementToCheck is a confirm message and originalStatement is undefined', function () {
            const statementToCheck = new xdr.ScpStatement({
                nodeId: xdr.PublicKey.publicKeyTypeEd25519(Keypair.random().rawPublicKey()),
                slotIndex: xdr.Uint64.fromString('1'),
                pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                    ballot: new xdr.ScpBallot({counter: 1, value: Buffer.alloc(32)}),
                    nPrepared: 1,
                    nCommit: 1,
                    nH: 1,
                    quorumSetHash: Buffer.alloc(32)
                }))
            });

            expect(isNewerConsensusStatement(statementToCheck, undefined)).toBe(true);
        });

        it('should return false if statementToCheck is a confirm message and originalStatement is an externalize message', function () {
            const keypair = Keypair.random();

            const statementToCheck = new xdr.ScpStatement({
                nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                slotIndex: xdr.Uint64.fromString('1'),
                pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                    ballot: new xdr.ScpBallot({counter: 1, value: Buffer.alloc(32)}),
                    nPrepared: 1,
                    nCommit: 1,
                    nH: 1,
                    quorumSetHash: Buffer.alloc(32)
                }))
            });

            const originalStatement = new xdr.ScpStatement({
                nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                slotIndex: xdr.Uint64.fromString('1'),
                pledges: xdr.ScpStatementPledges.scpStExternalize(new xdr.ScpStatementExternalize({
                    commit: new xdr.ScpBallot({counter: 2, value: Buffer.alloc(32)}),
                    nH: 1,
                    commitQuorumSetHash: Buffer.alloc(32)
                }))
            });

            expect(isNewerConsensusStatement(statementToCheck, originalStatement)).toBe(false);
        });

        describe('when statementToCheck is a confirm message and originalStatement is a confirm message', function () {
            it('should return false when statementToCheck has a lower counter', function () {
                const keypair = Keypair.random();

                const statementToCheck = new xdr.ScpStatement({
                    nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                    slotIndex: xdr.Uint64.fromString('1'),
                    pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                        ballot: new xdr.ScpBallot({counter: 1, value: Buffer.alloc(32)}),
                        nPrepared: 1,
                        nCommit: 1,
                        nH: 1,
                        quorumSetHash: Buffer.alloc(32)
                    }))
                });

                const originalStatement = new xdr.ScpStatement({
                    nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                    slotIndex: xdr.Uint64.fromString('1'),
                    pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                        ballot: new xdr.ScpBallot({counter: 2, value: Buffer.alloc(32)}),
                        nPrepared: 1,
                        nCommit: 1,
                        nH: 1,
                        quorumSetHash: Buffer.alloc(32)
                    }))
                });

                expect(isNewerConsensusStatement(statementToCheck, originalStatement)).toBe(false);
            });

            it('should return true when statementToCheck has a higher counter', function () {
                const keypair = Keypair.random();

                const statementToCheck = new xdr.ScpStatement({
                    nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                    slotIndex: xdr.Uint64.fromString('1'),
                    pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                        ballot: new xdr.ScpBallot({counter: 2, value: Buffer.alloc(32)}),
                        nPrepared: 1,
                        nCommit: 1,
                        nH: 1,
                        quorumSetHash: Buffer.alloc(32)
                    }))
                });

                const originalStatement = new xdr.ScpStatement({
                    nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                    slotIndex: xdr.Uint64.fromString('1'),
                    pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                        ballot: new xdr.ScpBallot({counter: 1, value: Buffer.alloc(32)}),
                        nPrepared: 1,
                        nCommit: 1,
                        nH: 1,
                        quorumSetHash: Buffer.alloc(32)
                    }))
                });

                expect(isNewerConsensusStatement(statementToCheck, originalStatement)).toBe(true);
            });

            describe('when statementToCheck has the same counter as originalStatement', function () {
                it('should return true when old statement has a lower ballot value string', function () {
                    const keypair = Keypair.random();

                    const statementToCheckBallotValueString = 'def';
                    const oldStatementBallotValueString = 'abc';
                    const statementToCheck = new xdr.ScpStatement({
                        nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                        slotIndex: xdr.Uint64.fromString('1'),
                        pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                            ballot: new xdr.ScpBallot({counter: 1, value: Buffer.from(statementToCheckBallotValueString)}),
                            nPrepared: 1,
                            nCommit: 1,
                            nH: 1,
                            quorumSetHash: Buffer.alloc(32)
                        }))
                    });

                    const originalStatement = new xdr.ScpStatement({
                        nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                        slotIndex: xdr.Uint64.fromString('1'),
                        pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                            ballot: new xdr.ScpBallot({counter: 1, value: Buffer.from(oldStatementBallotValueString)}),
                            nPrepared: 1,
                            nCommit: 1,
                            nH: 1,
                            quorumSetHash: Buffer.alloc(32)
                        }))
                    });

                    expect(isNewerConsensusStatement(statementToCheck, originalStatement)).toBe(true);
                });

                it('should return false when old statement has a higher ballot value string', function () {
                    const keypair = Keypair.random();

                    const statementToCheckBallotValueString = 'abc';
                    const oldStatementBallotValueString = 'def';

                    const statementToCheck = new xdr.ScpStatement({
                        nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                        slotIndex: xdr.Uint64.fromString('1'),
                        pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                            ballot: new xdr.ScpBallot({counter: 1, value: Buffer.from(statementToCheckBallotValueString)}),
                            nPrepared: 1,
                            nCommit: 1,
                            nH: 1,
                            quorumSetHash: Buffer.alloc(32)
                        }))
                    });

                    const originalStatement = new xdr.ScpStatement({
                        nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                        slotIndex: xdr.Uint64.fromString('1'),
                        pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                            ballot: new xdr.ScpBallot({counter: 1, value: Buffer.from(oldStatementBallotValueString)}),
                            nPrepared: 1,
                            nCommit: 1,
                            nH: 1,
                            quorumSetHash: Buffer.alloc(32)
                        }))
                    });

                    expect(isNewerConsensusStatement(statementToCheck, originalStatement)).toBe(false);
                });

                describe('when statementToCheck has the same ballot value string as originalStatement', function () {
                    it('should return true when old statement has a lower nPrepared', function () {
                        const keypair = Keypair.random();

                        const statementToCheck = new xdr.ScpStatement({
                            nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                            slotIndex: xdr.Uint64.fromString('1'),
                            pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                                ballot: new xdr.ScpBallot({counter: 1, value: Buffer.alloc(32)}),
                                nPrepared: 2,
                                nCommit: 1,
                                nH: 1,
                                quorumSetHash: Buffer.alloc(32)
                            }))
                        });

                        const originalStatement = new xdr.ScpStatement({
                            nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                            slotIndex: xdr.Uint64.fromString('1'),
                            pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                                ballot: new xdr.ScpBallot({counter: 1, value: Buffer.alloc(32)}),
                                nPrepared: 1,
                                nCommit: 1,
                                nH: 1,
                                quorumSetHash: Buffer.alloc(32)
                            }))
                        });

                        expect(isNewerConsensusStatement(statementToCheck, originalStatement)).toBe(true);
                    })

                    it('should return false when old statement has a higher nPrepared', function () {
                        const keypair = Keypair.random();

                        const statementToCheck = new xdr.ScpStatement({
                            nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                            slotIndex: xdr.Uint64.fromString('1'),
                            pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                                ballot: new xdr.ScpBallot({counter: 1, value: Buffer.alloc(32)}),
                                nPrepared: 1,
                                nCommit: 1,
                                nH: 1,
                                quorumSetHash: Buffer.alloc(32)
                            }))
                        });

                        const originalStatement = new xdr.ScpStatement({
                            nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                            slotIndex: xdr.Uint64.fromString('1'),
                            pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                                ballot: new xdr.ScpBallot({counter: 1, value: Buffer.alloc(32)}),
                                nPrepared: 2,
                                nCommit: 1,
                                nH: 1,
                                quorumSetHash: Buffer.alloc(32)
                            }))
                        });

                        expect(isNewerConsensusStatement(statementToCheck, originalStatement)).toBe(false);
                    });

                    describe('when statementToCheck has the same nPrepared as originalStatement', function () {
                        it('should return true when old statement has a lower nH', function () {
                            const keypair = Keypair.random();

                            const statementToCheck = new xdr.ScpStatement({
                                nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                                slotIndex: xdr.Uint64.fromString('1'),
                                pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                                    ballot: new xdr.ScpBallot({counter: 1, value: Buffer.alloc(32)}),
                                    nPrepared: 1,
                                    nCommit: 1,
                                    nH: 2,
                                    quorumSetHash: Buffer.alloc(32)
                                }))
                            });

                            const originalStatement = new xdr.ScpStatement({
                                nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                                slotIndex: xdr.Uint64.fromString('1'),
                                pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                                    ballot: new xdr.ScpBallot({counter: 1, value: Buffer.alloc(32)}),
                                    nPrepared: 1,
                                    nCommit: 1,
                                    nH: 1,
                                    quorumSetHash: Buffer.alloc(32)
                                }))
                            });

                            expect(isNewerConsensusStatement(statementToCheck, originalStatement)).toBe(true);
                        });

                        it('should return false when old statement has a higher nH', function () {
                            const keypair = Keypair.random();

                            const statementToCheck = new xdr.ScpStatement({
                                nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                                slotIndex: xdr.Uint64.fromString('1'),
                                pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                                    ballot: new xdr.ScpBallot({counter: 1, value: Buffer.alloc(32)}),
                                    nPrepared: 1,
                                    nCommit: 1,
                                    nH: 1,
                                    quorumSetHash: Buffer.alloc(32)
                                }))
                            });

                            const originalStatement = new xdr.ScpStatement({
                                nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                                slotIndex: xdr.Uint64.fromString('1'),
                                pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                                    ballot: new xdr.ScpBallot({counter: 1, value: Buffer.alloc(32)}),
                                    nPrepared: 1,
                                    nCommit: 1,
                                    nH: 2,
                                    quorumSetHash: Buffer.alloc(32)
                                }))
                            });

                            expect(isNewerConsensusStatement(statementToCheck, originalStatement)).toBe(false);
                        });

                        it('should return false when old statement has the same nH', function () {
                            const keypair = Keypair.random();

                            const statementToCheck = new xdr.ScpStatement({
                                nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                                slotIndex: xdr.Uint64.fromString('1'),
                                pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                                    ballot: new xdr.ScpBallot({counter: 1, value: Buffer.alloc(32)}),
                                    nPrepared: 1,
                                    nCommit: 1,
                                    nH: 1,
                                    quorumSetHash: Buffer.alloc(32)
                                }))
                            });

                            const originalStatement = new xdr.ScpStatement({
                                nodeId: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()),
                                slotIndex: xdr.Uint64.fromString('1'),
                                pledges: xdr.ScpStatementPledges.scpStConfirm(new xdr.ScpStatementConfirm({
                                    ballot: new xdr.ScpBallot({counter: 1, value: Buffer.alloc(32)}),
                                    nPrepared: 1,
                                    nCommit: 1,
                                    nH: 1,
                                    quorumSetHash: Buffer.alloc(32)
                                }))
                            });

                            expect(isNewerConsensusStatement(statementToCheck, originalStatement)).toBe(false);
                        });
                    });
                });
            });
        });
    });
});