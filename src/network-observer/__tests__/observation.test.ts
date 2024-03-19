import { Observation } from '../observation';
import { PeerNodeCollection } from '../../peer-node-collection';
import { mock } from 'jest-mock-extended';
import { NodeAddress } from '../../node-address';
import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { P } from 'pino';
import { ObservationState } from '../observation-state';
import { Slots } from '../peer-event-handler/stellar-message-handlers/scp-envelope/scp-statement/externalize/slots';

describe('Observation', () => {
	const createObservation = (topTierAddresses: NodeAddress[] = []) => {
		return new Observation(
			'test',
			topTierAddresses,
			mock<PeerNodeCollection>(),
			{
				sequence: BigInt(0),
				closeTime: new Date(),
				value: '',
				localCloseTime: new Date()
			},
			new Map<string, QuorumSet>(),
			new Slots(new QuorumSet(1, ['A'], []), mock<P.Logger>())
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
		expect(observation.latestConfirmedClosedLedger.sequence).toEqual(BigInt(1));
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
		expect(observation.latestConfirmedClosedLedger.sequence).toBe(BigInt(0));
	});

	it('should mark network halted if new ledger is found after network was previously halted', () => {
		const observation = createObservation();
		observation.moveToSyncingState();
		observation.moveToSyncedState();
		observation.setNetworkHalted();
		const ledger = {
			sequence: BigInt(1),
			closeTime: new Date(),
			value: 'value',
			localCloseTime: new Date()
		};
		observation.ledgerCloseConfirmed(ledger);
		expect(observation.latestConfirmedClosedLedger.sequence).toBe(BigInt(1));
		expect(observation.isNetworkHalted()).toBeFalsy();
	});
});
