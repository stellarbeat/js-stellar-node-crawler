import { PeerNode } from './peer-node';

export function listenFurther(
	peer: PeerNode,
	timeoutCounter: number,
	maxTimeoutCounter: number,
	topTierNodes: Set<string>,
	queueLength: number,
	peerNodes: Map<string, PeerNode>
): boolean {
	if (timeoutCounter === 0) return true; //everyone gets a first listen. If it is already confirmed validating, we can still use it to request unknown quorumSets from.
	//CONSENSUS_STUCK_TIMEOUT_SECONDS in stellar core is 35 seconds, we wait twice that time to ensure we receive al externalizing messages from straggling nodes;
	if (timeoutCounter >= maxTimeoutCounter) return false; //we wait for 70 seconds max (maxCounter = 70 / SCP_TIMEOUT)if node is trying to reach consensus.
	if (peer.isValidatingIncorrectValues) return false;
	if (!peer.participatingInSCP && !topTierNodes.has(peer.publicKey))
		return false; //watcher node
	if (peer.isValidating && peer.quorumSet && !topTierNodes.has(peer.publicKey))
		//todo: a peer that is validating but doesnt have it's own quorumSet, could keep listening until max.
		return false; //we have all the needed information

	return !queueIsEmptyAndTopTierNodesParticipatingInSCPAreAllValidating(
		queueLength,
		peerNodes,
		topTierNodes
	);
}

function queueIsEmptyAndTopTierNodesParticipatingInSCPAreAllValidating(
	queueLength: number,
	peerNodes: Map<string, PeerNode>,
	topTierNodes: Set<string>
) {
	return (
		queueLength === 0 &&
		Array.from(topTierNodes).every((publicKey) => {
			const peerNode = peerNodes.get(publicKey);
			if (!peerNode) return true; //at this point, we won't receive anymore peerNodes, so we can't let it stall the process.
			return peerNode.isValidating && peerNode.participatingInSCP;
		})
	);
}
