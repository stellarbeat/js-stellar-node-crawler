export class MaxCrawlTimeManager {
	private timer?: NodeJS.Timeout;

	setTimer(maxCrawlTime: number, onMaxCrawlTime: () => void) {
		if (this.timer) {
			clearTimeout(this.timer);
		}
		this.timer = setTimeout(onMaxCrawlTime, maxCrawlTime);
	}

	clearTimer() {
		if (this.timer) {
			clearTimeout(this.timer);
		}
	}
}
