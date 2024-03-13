import { Observation } from '../observation';
import { PeerNodeCollection } from '../../peer-node-collection';
import { mock } from 'jest-mock-extended';
import { CrawlState } from '../../crawl-state';
import { NodeAddress } from '../../node-address';
import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { P } from 'pino';
import { ObservationState } from '../observation-state';

describe('Observation', () => {
	const createObservation = (topTierAddresses: NodeAddress[] = []) => {
		return new Observation(
			topTierAddresses,
			mock<PeerNodeCollection>(),
			new CrawlState(
				new QuorumSet(2, ['A']),
				new Map<string, QuorumSet>(),
				{
					sequence: BigInt(0),
					closeTime: new Date(),
					value: 'value',
					localCloseTime: new Date()
				},
				'test',
				mock<P.Logger>()
			)
		);
	};
	it('should move to syncing state', () => {
		const observation = createObservation();
		observation.moveToSyncingState();
		expect(observation.state).toBe(ObservationState.Syncing);
	});

	it('should map top tier addresses', () => {
		const observation = createObservation([
			['a', 1],
			['b', 2]
		]);
		expect(observation.topTierAddressesSet).toEqual(new Set(['a:1', 'b:2']));
	});

	it('should move to synced state', () => {
		const observation = createObservation();
		observation.moveToSyncingState();
		observation.moveToSyncedState();
		expect(observation.state).toBe(ObservationState.Synced);
	});

	it('should move to stopping state', () => {
		const observation = createObservation();
		observation.moveToSyncingState();
		observation.moveToSyncedState();
		observation.moveToStoppingState();
		expect(observation.state).toBe(ObservationState.Stopping);
	});

	it('should move to stopped state', () => {
		const observation = createObservation();
		observation.moveToSyncingState();
		observation.moveToSyncedState();
		observation.moveToStoppingState();
		observation.moveToStoppedState();
		expect(observation.state).toBe(ObservationState.Stopped);
	});

	it('should confirm ledger close', () => {
		const observation = createObservation();
		observation.moveToSyncingState();
		observation.moveToSyncedState();
		const ledger = {
			sequence: BigInt(1),
			closeTime: new Date(),
			value: 'value',
			localCloseTime: new Date()
		};
		observation.ledgerCloseConfirmed(ledger);
		expect(observation.crawlState.latestConfirmedClosedLedger.sequence).toEqual(
			BigInt(1)
		);
	});

	it('should not confirm ledger close if not in synced state', () => {
		const observation = createObservation();
		const ledger = {
			sequence: BigInt(1),
			closeTime: new Date(),
			value: 'value',
			localCloseTime: new Date()
		};
		observation.ledgerCloseConfirmed(ledger);
		expect(observation.crawlState.latestConfirmedClosedLedger.sequence).toBe(
			BigInt(0)
		);
	});

	it('should not confirm ledger close if network halted', () => {
		const observation = createObservation();
		observation.moveToSyncingState();
		observation.moveToSyncedState();
		observation.networkHalted = true;
		const ledger = {
			sequence: BigInt(1),
			closeTime: new Date(),
			value: 'value',
			localCloseTime: new Date()
		};
		observation.ledgerCloseConfirmed(ledger);
		expect(observation.crawlState.latestConfirmedClosedLedger.sequence).toBe(
			BigInt(0)
		);
	});
});
