import * as P from "pino";
import {PeerNode} from "./peer-node";
import {xdr} from "stellar-base";
import {CrawlState} from "./crawl-state";
import {Connection, getPublicKeyStringFromBuffer} from "@stellarbeat/js-stellar-node-connector";
import {QuorumSetManager} from "./quorum-set-manager";

export class ScpManager {
    protected logger: P.Logger;
    protected quorumSetManager: QuorumSetManager;

    constructor(quorumSetManager: QuorumSetManager, logger: P.Logger) {
        this.logger = logger;
        this.quorumSetManager = quorumSetManager;
    }

    public processScpStatement(connection: Connection, scpStatement: xdr.ScpStatement, crawlState: CrawlState) {
        let publicKeyResult = getPublicKeyStringFromBuffer(scpStatement.nodeId().value());
        if (publicKeyResult.isErr()) {
            connection.destroy(publicKeyResult.error);
            return;
        }

        let publicKey = publicKeyResult.value;

        this.logger.debug({
            'peer': connection.remoteAddress,
            'publicKey': publicKey,
            'slotIndex': scpStatement.slotIndex().toString()
        }, 'processing new scp statement: ' + scpStatement.pledges().switch().name);

        let peer = crawlState.peerNodes.get(publicKey);
        if (!peer) {
            peer = new PeerNode(publicKey);
            crawlState.peerNodes.set(publicKey, peer);
        }

        peer.latestActiveSlotIndex = scpStatement.slotIndex().toString();

        this.quorumSetManager.processQuorumSetHashFromStatement(peer, scpStatement, crawlState);

        if (scpStatement.pledges().switch().value !== xdr.ScpStatementType.scpStExternalize().value) { //only if node is externalizing, we mark the node as validating
            return;
        }

        this.processExternalizeStatement(peer, BigInt(scpStatement.slotIndex().toString()), scpStatement.pledges().externalize(), crawlState)
    }

    protected processExternalizeStatement(peer: PeerNode, slotIndex: bigint, statementExternalize: xdr.ScpStatementExternalize, crawlState: CrawlState) {
        let value = statementExternalize.commit().value().toString('base64');
        this.logger.debug({
            'publicKey': peer.publicKey,
            'slotIndex': slotIndex
        }, 'externalize msg with value: ' + value);

        let markNodeAsValidating = (peer: PeerNode) => {
            if (!peer.isValidating) {
                this.logger.info({
                    'pk': peer.publicKey,
                }, 'Validating');
            }
            peer.isValidating = true;
        }

        let slot = crawlState.slots.getSlot(slotIndex);
        let slotWasClosedBefore = slot.closed();
        //TODO: maybe not try to close older SLOTS
        slot.addExternalizeValue(peer.publicKey, value);

        if (slot.closed()) {
            if (!slotWasClosedBefore) {//we just closed the slot, lets mark all nodes as validating!
                this.logger.info({ledger: slotIndex.toString()}, 'Ledger closed!');
                crawlState.latestClosedLedger = {
                    sequence: slotIndex,
                    closeTime: new Date()
                }
                slot.getNodesAgreeingOnExternalizedValue().forEach(validatingPublicKey => {
                    let validatingPeer = crawlState.peerNodes.get(validatingPublicKey);
                    if (validatingPeer)
                        markNodeAsValidating(validatingPeer);
                });
            } else { //if the slot was already closed, we check if this new (?) node should be marked as validating
                if (value === slot.externalizedValue)
                    markNodeAsValidating(peer);
            }
        }
    }

}