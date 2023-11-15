import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import * as P from 'pino';
import containsSlice from '@stellarbeat/js-stellarbeat-shared/lib/quorum/containsSlice';
import { xdr } from 'stellar-base';
import { isNewerConsensusStatement } from './order-scp-statements';

export type SlotIndex = bigint;
type NodeId = string;
type SlotValue = string;

export class Slot {
	public index: SlotIndex;
	public externalizedValue?: SlotValue;
	private valuesMap: Map<SlotValue, Set<NodeId>> = new Map();
	//deprecated, should be handled on a higher level
	private readonly trustedQuorumSet: QuorumSet;
	private statementsMap: Map<NodeId, xdr.ScpStatement> = new Map();

	constructor(index: SlotIndex, trustedQuorumSet: QuorumSet) {
		this.index = index;
		this.trustedQuorumSet = trustedQuorumSet;
	}

	registerStatement(nodeId: NodeId, statement: xdr.ScpStatement): void {
		if (
			![
				xdr.ScpStatementType.scpStExternalize(),
				xdr.ScpStatementType.scpStConfirm()
			].includes(statement.pledges().switch())
		) {
			return;
		}

		const oldStatement = this.statementsMap.get(nodeId);
		if (oldStatement && isNewerConsensusStatement(statement, oldStatement)) {
			this.statementsMap.set(nodeId, statement);
		}
		if (!oldStatement) this.statementsMap.set(nodeId, statement);
	}

	getStatement(nodeId: NodeId): xdr.ScpStatement | undefined {
		return this.statementsMap.get(nodeId);
	}

	getNodesAgreeingOnExternalizedValue(): Set<NodeId> {
		if (this.externalizedValue === undefined) return new Set();

		const nodes = this.valuesMap.get(this.externalizedValue);
		if (!nodes) return new Set();

		return nodes;
	}

	getNodesDisagreeingOnExternalizedValue(): Set<NodeId> {
		let nodes = new Set<NodeId>();
		if (this.externalizedValue === undefined) return nodes;

		Array.from(this.valuesMap.keys())
			.filter((value) => value !== this.externalizedValue)
			.forEach((value) => {
				const otherNodes = this.valuesMap.get(value);
				if (otherNodes) nodes = new Set([...nodes, ...otherNodes]);
			});

		return nodes;
	}

	addExternalizeValue(nodeId: NodeId, value: SlotValue): void {
		let nodesThatExternalizedValue = this.valuesMap.get(value);
		if (!nodesThatExternalizedValue) {
			nodesThatExternalizedValue = new Set();
			this.valuesMap.set(value, nodesThatExternalizedValue);
		}

		if (nodesThatExternalizedValue.has(nodeId))
			//already recorded, no need to check if closed
			return;

		nodesThatExternalizedValue.add(nodeId);

		if (this.closed()) return;

		//this should move higher up.
		if (QuorumSet.getAllValidators(this.trustedQuorumSet).includes(nodeId)) {
			if (containsSlice(this.trustedQuorumSet, nodesThatExternalizedValue))
				//try to close slot
				this.externalizedValue = value;
		}
	}

	closed(): boolean {
		return this.externalizedValue !== undefined;
	}
}
