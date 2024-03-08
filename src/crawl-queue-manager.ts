import { CrawlState } from './crawl-state';
import * as P from 'pino';
import { nodeAddressToPeerKey } from './node-address';
import { AsyncResultCallback, CrawlQueue } from './crawl-queue';
import { CrawlTask } from './crawl-task';

export class CrawlQueueManager {
	constructor(private crawlQueue: CrawlQueue, private logger: P.Logger) {
		this.crawlQueue.initialize(this.performCrawlQueueTask.bind(this));
	}

	public addCrawlTask(crawlTask: CrawlTask): void {
		const peerKey = nodeAddressToPeerKey(crawlTask.nodeAddress);
		this.logNodeAddition(crawlTask.crawlState, peerKey);

		if (this.hasNodeBeenCrawled(crawlTask.crawlState, peerKey)) return;

		crawlTask.crawlState.crawledNodeAddresses.add(peerKey);

		this.crawlQueue.push(crawlTask, (error?: Error) => {
			if (error) {
				this.logger.error(
					{ peer: crawlTask.nodeAddress[0] + ':' + crawlTask.nodeAddress[1] },
					error.message
				);
			}
		});
	}

	private hasNodeBeenCrawled(crawlState: CrawlState, peerKey: string): boolean {
		return crawlState.crawledNodeAddresses.has(peerKey);
	}

	private logNodeAddition(crawlState: CrawlState, peerKey: string): void {
		if (this.hasNodeBeenCrawled(crawlState, peerKey)) {
			this.logger.debug({ peer: peerKey }, 'Address already crawled');
		} else {
			this.logger.debug({ peer: peerKey }, 'Adding address to crawl queue');
		}
	}

	public onDrain(callback: () => void) {
		this.crawlQueue.onDrain(callback);
	}

	public queueLength(): number {
		return this.crawlQueue.length();
	}

	private performCrawlQueueTask(
		crawlQueueTask: CrawlTask,
		crawlQueueTaskDone: AsyncResultCallback<void>
	): void {
		crawlQueueTask.crawlState.crawlQueueTaskDoneCallbacks.set(
			crawlQueueTask.nodeAddress.join(':'),
			crawlQueueTaskDone
		);

		crawlQueueTask.connectCallback();
	}

	public completeCrawlQueueTask(
		crawlQueueTaskDoneCallbacks: Map<string, AsyncResultCallback<void>>,
		nodeAddress: string
	): void {
		const taskDoneCallback = crawlQueueTaskDoneCallbacks.get(nodeAddress);
		if (taskDoneCallback) {
			taskDoneCallback();
			crawlQueueTaskDoneCallbacks.delete(nodeAddress);
		} else {
			this.logger.error(
				{ peer: nodeAddress },
				'No crawlQueueTaskDoneCallback found'
			);
		}
	}
}
