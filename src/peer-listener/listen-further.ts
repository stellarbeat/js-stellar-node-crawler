import { PeerNode } from '../peer-node';

const peerInformationRetrievedState = new Map<string, boolean>();

export function listenFurther(
	peer: PeerNode,
	timeoutCounter: number,
	maxTimeoutCounter: number,
	isTopTierNode: boolean,
	crawlingIsDone: boolean
): boolean {
	if (isBadPeer(peer)) return false;

	if (isTopTierNode) {
		return handleTopTierNode(
			peer,
			timeoutCounter,
			maxTimeoutCounter,
			crawlingIsDone
		);
	}

	return listenFurtherInternal(peer, timeoutCounter, maxTimeoutCounter);
}

function handleTopTierNode(
	peer: PeerNode,
	timeoutCounter: number,
	maxTimeoutCounter: number,
	crawlingIsDone: boolean
): boolean {
	if (!crawlingIsDone) {
		return true;
	}

	return listenFurtherInternal(peer, timeoutCounter, maxTimeoutCounter);
}

function listenFurtherInternal(
	peer: PeerNode,
	timeoutCounter: number,
	maxTimeoutCounter: number
): boolean {
	if (
		isFirstListen(timeoutCounter) ||
		peerInformationRetrievedState.get(peer.publicKey)
	) {
		return true;
	}

	if (allInformationRetrieved(peer)) {
		peerInformationRetrievedState.set(peer.publicKey, true);
		return false; //we have all the information, but keep listening one round for straggler nodes whose messages are relayed by this node
	}

	return !(
		exceededMaxTimeout(timeoutCounter, maxTimeoutCounter) || isWatcherNode(peer)
	);
}

function isBadPeer(peer: PeerNode) {
	return peer.isValidatingIncorrectValues;
}

function isFirstListen(timeoutCounter: number) {
	return timeoutCounter === 0;
}

//CONSENSUS_STUCK_TIMEOUT_SECONDS in stellar core is 35 seconds, we wait twice that time to ensure we receive al externalizing messages from straggling nodes;
//we wait for 70 seconds max (maxCounter = 70 / SCP_TIMEOUT)if node is trying to reach consensus.
function exceededMaxTimeout(timeoutCounter: number, maxTimeoutCounter: number) {
	return timeoutCounter >= maxTimeoutCounter;
}

function isWatcherNode(peer: PeerNode) {
	return !peer.participatingInSCP;
}

function allInformationRetrieved(peer: PeerNode) {
	return peer.isValidating && peer.connectedDuringLedgerClose && peer.quorumSet;
}
