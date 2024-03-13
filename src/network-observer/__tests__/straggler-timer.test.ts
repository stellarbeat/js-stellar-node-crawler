import { mock } from 'jest-mock-extended';
import { P } from 'pino';
import { ConnectionManager } from '../connection-manager';
import { StragglerTimer } from '../straggler-timer';
import { Timers } from '../../utilities/timers';

describe('StragglerTimer', () => {
	const logger = mock<P.Logger>();
	const connectionManager = mock<ConnectionManager>();
	const timers = mock<Timers>();
	const stragglerHandler = new StragglerTimer(
		connectionManager,
		timers,
		1000,
		logger
	);

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('should start straggler timeout', () => {
		const addresses = ['address1', 'address2'];
		stragglerHandler.startStragglerTimeout(addresses);
		const callback1 = timers.startTimer.mock.calls[0][1];
		expect(timers.startTimer).toHaveBeenCalledTimes(1);
		callback1();

		expect(connectionManager.disconnectByAddress).toHaveBeenCalledWith(
			'address1'
		);
		expect(connectionManager.disconnectByAddress).toHaveBeenCalledWith(
			'address2'
		);
	});

	it('should not start timeout if addresses is empty', () => {
		stragglerHandler.startStragglerTimeout([]);
		expect(timers.startTimer).not.toHaveBeenCalled();
	});

	it('should start straggler timeout for active non top tier peers', () => {
		connectionManager.getActiveConnectionAddresses.mockReturnValue([
			'peerAddress',
			'topTierAddress'
		]);
		stragglerHandler.startStragglerTimeoutForActivePeers(
			false,
			new Set(['topTierAddress'])
		);
		const callback1 = timers.startTimer.mock.calls[0][1];
		expect(timers.startTimer).toHaveBeenCalledTimes(1);
		callback1();

		expect(connectionManager.disconnectByAddress).toHaveBeenCalledWith(
			'peerAddress'
		);
		expect(connectionManager.disconnectByAddress).toHaveBeenCalledTimes(1);
	});

	it('should start straggler timeout for active top tier peers', () => {
		connectionManager.getActiveConnectionAddresses.mockReturnValue([
			'peerAddress',
			'topTierAddress'
		]);
		stragglerHandler.startStragglerTimeoutForActivePeers(
			true,
			new Set('topTierAddress')
		);
		const callback1 = timers.startTimer.mock.calls[0][1];
		expect(timers.startTimer).toHaveBeenCalledTimes(1);
		callback1();

		expect(connectionManager.disconnectByAddress).toHaveBeenCalledTimes(2);
		expect(connectionManager.disconnectByAddress).toHaveBeenCalledWith(
			'peerAddress'
		);
		expect(connectionManager.disconnectByAddress).toHaveBeenCalledWith(
			'topTierAddress'
		);
	});
});
