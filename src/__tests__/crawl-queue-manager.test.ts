import { AsyncCrawlQueue } from '../crawl-queue';
import { CrawlQueueManager } from '../crawl-queue-manager';
import { mock } from 'jest-mock-extended';
import { P } from 'pino';
import { CrawlState } from '../crawl-state';
import { CrawlTask } from '../crawl-task';
import { nodeAddressToPeerKey } from '../node-address';

describe('CrawlQueueManager', () => {
	const crawlQueue = mock<AsyncCrawlQueue>();
	const logger = mock<P.Logger>();
	const crawlState = mock<CrawlState>();

	beforeEach(() => {
		crawlState.crawledNodeAddresses = new Set();
		crawlState.crawlQueueTaskDoneCallbacks = new Map();
		jest.clearAllMocks();
	});

	it('should add a crawl task', () => {
		const crawlQueueManager = new CrawlQueueManager(crawlQueue, logger);
		crawlQueueManager.addCrawlTask({
			connectCallback: () => {},
			crawlState,
			nodeAddress: ['localhost', 11625],
			topTier: false
		});

		expect(crawlQueue.push).toHaveBeenCalled();
	});

	it('should not add a crawl task if the node has been crawled', () => {
		const crawlQueueManager = new CrawlQueueManager(crawlQueue, logger);
		crawlQueueManager.addCrawlTask({
			connectCallback: () => {},
			crawlState,
			nodeAddress: ['localhost', 11625],
			topTier: false
		});
		crawlQueueManager.addCrawlTask({
			connectCallback: () => {},
			crawlState,
			nodeAddress: ['localhost', 11625],
			topTier: false
		});

		expect(crawlQueue.push).toHaveBeenCalledTimes(1);
	});

	it('should call onDrain', () => {
		const crawlQueueManager = new CrawlQueueManager(crawlQueue, logger);
		crawlQueueManager.onDrain(() => {});
		expect(crawlQueue.onDrain).toHaveBeenCalled();
	});

	it('should return the queue length', () => {
		const crawlQueueManager = new CrawlQueueManager(crawlQueue, logger);
		crawlQueueManager.queueLength();
		expect(crawlQueue.length).toHaveBeenCalled();
	});

	it('should initialize the crawl queue', () => {
		new CrawlQueueManager(crawlQueue, logger);
		expect(crawlQueue.initialize).toHaveBeenCalled();
	});

	it('should perform a crawl queue task', () => {
		const task: CrawlTask = {
			connectCallback: jest.fn(),
			crawlState,
			nodeAddress: ['localhost', 11625],
			topTier: false
		};

		crawlQueue.initialize.mockImplementation((callback) => {
			callback(task, () => {});
		});

		const crawlQueueManager = new CrawlQueueManager(crawlQueue, logger);
		crawlQueueManager.queueLength();
		expect(task.connectCallback).toHaveBeenCalled();
	});

	it('should complete a crawl task', function () {
		const task: CrawlTask = {
			connectCallback: jest.fn(),
			crawlState,
			nodeAddress: ['localhost', 11625],
			topTier: false
		};

		crawlQueue.initialize.mockImplementation((callback) => {
			callback(task, () => {}); //execute the async task
		});

		const crawlQueueManager = new CrawlQueueManager(crawlQueue, logger);
		expect(crawlState.crawlQueueTaskDoneCallbacks.size).toBe(1);
		crawlQueueManager.completeCrawlQueueTask(
			crawlState.crawlQueueTaskDoneCallbacks,
			nodeAddressToPeerKey(task.nodeAddress)
		);
		expect(crawlState.crawlQueueTaskDoneCallbacks.size).toBe(0);
	});
});
