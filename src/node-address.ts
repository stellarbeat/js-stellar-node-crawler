export type NodeAddress = [ip: string, port: number];

export function nodeAddressToPeerKey(nodeAddress: NodeAddress) {
	return nodeAddress[0] + ':' + nodeAddress[1];
}
