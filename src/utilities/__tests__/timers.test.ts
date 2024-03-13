import { TimerFactory } from '../timer-factory';
import { Timers } from '../timers';
import { mock } from 'jest-mock-extended';
import { Timer } from '../timer';

describe('timers', () => {
	const timerFactory = mock<TimerFactory>();
	const timers = new Timers(timerFactory);

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('should start timer', () => {
		const callback = jest.fn();
		const timer = mock<Timer>();
		timerFactory.createTimer.mockReturnValue(timer);
		timers.startTimer(1000, callback);

		const calledTime = timer.start.mock.calls[0][0];
		const timerCallback = timer.start.mock.calls[0][1];

		timerCallback();

		expect(calledTime).toBe(1000);
		expect(timerFactory.createTimer).toHaveBeenCalled();
		expect(timer.start).toHaveBeenCalled();
		expect(timers.hasActiveTimers()).toBeFalsy();
	});

	it('should stop timers', () => {
		const timer = mock<Timer>();
		timerFactory.createTimer.mockReturnValue(timer);
		const callback = jest.fn();
		timers.startTimer(1000, callback);
		timers.stopTimers();
		expect(timer.stopTimer).toHaveBeenCalled();
		expect(timers.hasActiveTimers()).toBeFalsy();
		expect(callback).not.toHaveBeenCalled();
	});
});
