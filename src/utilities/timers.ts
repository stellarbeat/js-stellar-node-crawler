import { Timer } from './timer';
import { TimerFactory } from './timer-factory';

export class Timers {
	private timers: Set<Timer> = new Set();

	constructor(private timerFactory: TimerFactory) {}

	public startTimer(time: number, callback: () => void) {
		const timer = this.timerFactory.createTimer();
		const myCallback = () => {
			this.timers.delete(timer);
			callback();
		};
		timer.startTimer(time, myCallback);
		this.timers.add(timer);
	}

	public stopTimers() {
		this.timers.forEach((timer) => timer.stopTimer());
		this.timers = new Set();
	}

	public hasActiveTimers() {
		return this.timers.size > 0;
	}
}
