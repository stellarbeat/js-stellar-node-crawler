import { Timer } from './timer';

export class TimerFactory {
	createTimer() {
		return new Timer();
	}
}
