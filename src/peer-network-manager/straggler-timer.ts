import { Timer } from '../utilities/timer';

export class StragglerTimer {
	private timers: Set<Timer> = new Set();

	startTimer(time: number, callback: () => void) {
		const timer = new Timer();
		const myCallback = () => {
			this.timers.delete(timer);
			callback();
		};
		timer.startTimer(time, callback);
		this.timers.add(timer);
	}

	stopTimers() {
		this.timers.forEach((timer) => timer.stopTimer());
	}
}
