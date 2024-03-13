import { NodeAddress } from '../node-address';
import {
	PeerNetworkManager,
	PeerNetworkManagerState
} from './peer-network-manager';
import { StragglerTimer } from './straggler-timer';
import { Timer } from '../utilities/timer';
import { ConnectionManager } from './connection-manager';
import * as assert from 'assert';
import { P } from 'pino';
import { CrawlState } from '../crawl-state';
import { Ledger } from '../crawler';

export class PeerNetworkStateManager {
	private _state: PeerNetworkManagerState = PeerNetworkManagerState.Idle;
	private _topTierAddresses: Set<string> = new Set();
	private _networkHalted: boolean = false;

	constructor(
		private connectionManager: ConnectionManager,
		private networkConsensusTimerManager: Timer,
		private stragglerTimer: StragglerTimer,
		private logger: P.Logger
	) {}

	public moveToSyncingState(topTierNodes: NodeAddress[]): void {
		assert(this._state === PeerNetworkManagerState.Idle);
		this._state = PeerNetworkManagerState.Syncing;
		this._networkHalted = false;

		this.connectToTopTierNodes(topTierNodes);
		this._topTierAddresses = this.mapTopTierAddresses(topTierNodes);
	}

	public moveToSyncedState() {
		assert(this._state === PeerNetworkManagerState.Syncing);
		this._state = PeerNetworkManagerState.Synced;
		this.startNetworkConsensusTimer();
	}

	public ledgerCloseConfirmed(crawlState: CrawlState, ledger: Ledger) {
		if (this.state !== PeerNetworkManagerState.Synced) return;
		if (this.isNetworkHalted) return;

		crawlState.updateLatestConfirmedClosedLedger(ledger);

		this.stragglerTimer.startStragglerTimeoutForActivePeers(
			false,
			this.topTierAddresses
		);

		this.startNetworkConsensusTimer();
	}

	private startNetworkConsensusTimer() {
		const onNetworkHaltedCallback = () => {
			this.logger.info('Network consensus timeout');
			this._networkHalted = true;
			this.stragglerTimer.startStragglerTimeoutForActivePeers(
				false,
				this._topTierAddresses
			);
		};
		this.startNetworkConsensusTimerInternal(onNetworkHaltedCallback);
	}

	public moveToStoppingState(doneCallback: () => void) {
		assert(this._state !== PeerNetworkManagerState.Idle);
		this._state = PeerNetworkManagerState.Stopping;
		this.networkConsensusTimerManager.stopTimer();
		if (this.connectionManager.getActiveConnectionAddresses().length === 0) {
			return this.moveToIdleState(doneCallback);
		}

		this.stragglerTimer.startStragglerTimeoutForActivePeers(
			true,
			this._topTierAddresses
		);
	}

	public moveToIdleState(callback: () => void) {
		assert(this._state === PeerNetworkManagerState.Stopping);
		this.stragglerTimer.stopTimers(); //a node could have disconnected during the straggler timeout
		this.connectionManager.shutdown();
		this._state = PeerNetworkManagerState.Idle;
		callback();
	}

	get isNetworkHalted() {
		return this._networkHalted;
	}

	get state() {
		return this._state;
	}

	get topTierAddresses() {
		return this._topTierAddresses;
	}

	private startNetworkConsensusTimerInternal(onNetworkHalted: () => void) {
		this.networkConsensusTimerManager.startTimer(
			PeerNetworkManager.NETWORK_CONSENSUS_TIMEOUT,
			onNetworkHalted
		);
	}

	private mapTopTierAddresses(topTierNodes: NodeAddress[]) {
		const topTierAddresses = new Set<string>();
		topTierNodes.forEach((address) => {
			topTierAddresses.add(`${address[0]}:${address[1]}`);
		});
		return topTierAddresses;
	}

	private connectToTopTierNodes(topTierNodes: NodeAddress[]) {
		topTierNodes.forEach((address) => {
			this.connectionManager.connectToNode(address[0], address[1]);
		});
	}
}
