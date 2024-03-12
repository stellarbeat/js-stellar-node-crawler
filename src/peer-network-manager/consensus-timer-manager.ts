export class ConsensusTimerManager {
	private timer: NodeJS.Timeout | null = null;

	constructor() {}

	startTimer(time: number, callback: () => void) {
		if (this.timer) {
			clearTimeout(this.timer);
		}
		this.timer = setTimeout(() => {
			callback();
		}, time);
	}

	stopTimer() {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}
}
