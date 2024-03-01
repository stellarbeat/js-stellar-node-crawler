import { queue, QueueObject } from 'async';
import { CrawlTask } from './crawl-task';

export interface CrawlQueue {
	push(crawlTask: CrawlTask, error: () => void): void;
	onDrain(callback: () => void): void;
	activeTasks(): CrawlTask[];
	length(): number;
	initialize(
		performTask: (task: CrawlTask, done: AsyncResultCallback<void>) => void
	): void;
}

export interface AsyncResultCallback<T, E = Error> {
	(err?: E | null, result?: T): void;
}

export class AsyncCrawlQueue implements CrawlQueue {
	private _crawlQueue?: QueueObject<CrawlTask>;
	constructor(private maxOpenConnections: number) {}

	private get crawlQueue(): QueueObject<CrawlTask> {
		if (!this._crawlQueue) throw new Error('Crawl queue not set up');
		return this._crawlQueue;
	}

	initialize(
		performTask: (task: CrawlTask, done: AsyncResultCallback<void>) => void
	) {
		this._crawlQueue = queue(performTask, this.maxOpenConnections);
	}

	push<R, E = Error>(
		crawlTask: CrawlTask,
		callback: AsyncResultCallback<R, E>
	): void {
		this.crawlQueue.push(crawlTask, callback);
	}

	onDrain(callback: () => void): void {
		this.crawlQueue.drain(callback);
	}

	length(): number {
		return this.crawlQueue.length();
	}

	activeTasks(): CrawlTask[] {
		return this.crawlQueue.workersList().map((worker) => worker.data);
	}
}
