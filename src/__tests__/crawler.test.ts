import { Crawler } from '../index';
import { createDummyCrawlerConfiguration } from '../__fixtures__/createDummyCrawlerConfiguration';
import { CrawlQueueManager } from '../crawl-queue-manager';
import { MaxCrawlTimeManager } from '../max-crawl-time-manager';
import { P } from 'pino';
import { mock, MockProxy } from 'jest-mock-extended';
import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { CrawlLogger } from '../crawl-logger';
import { CrawlProcessState, CrawlState } from '../crawl-state';
import { EventEmitter } from 'events';
import { AsyncCrawlQueue } from '../crawl-queue';
import { NetworkObserver } from '../network-observer/network-observer';
import { ClosePayload } from '../network-observer/connection-manager';
import { Observation } from '../network-observer/observation';
import { PeerNodeCollection } from '../peer-node-collection';

describe('Crawler', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	function setupSUT() {
		const crawlQueueManager = new CrawlQueueManager(
			new AsyncCrawlQueue(1),
			mock<P.Logger>()
		);
		const maxCrawlTimeManager = mock<MaxCrawlTimeManager>();
		const networkObserver = mock<NetworkObserver>();
		const crawlLogger = mock<CrawlLogger>();
		const logger = mock<P.Logger>();
		logger.child.mockReturnValue(logger as any);
		const networkObserverEventEmitter = new EventEmitter();

		networkObserver.on.mockImplementation((event, listener) => {
			networkObserverEventEmitter.on(event, listener);
			return networkObserver;
		});

		const crawler = new Crawler(
			createDummyCrawlerConfiguration(),
			crawlQueueManager,
			maxCrawlTimeManager,
			networkObserver,
			crawlLogger,
			logger
		);
		const crawlState = new CrawlState(
			new QuorumSet(2, []),
			new Map(),
			{
				closeTime: new Date(0),
				localCloseTime: new Date(0),
				sequence: BigInt(0),
				value: ''
			},
			'test',
			logger
		);

		return {
			crawler,
			crawlState,
			networkObserver,
			networkObserverEventEmitter,
			crawlLogger,
			maxCrawlTimeManager
		};
	}

	it('should create a Crawler', () => {
		const crawler = setupSUT().crawler;
		expect(crawler).toBeInstanceOf(Crawler);
	});

	it('should return error if no active top tier connections and no node addresses to crawl', async () => {
		const {
			crawler,
			crawlState,
			networkObserver,
			crawlLogger,
			maxCrawlTimeManager
		} = setupSUT();
		networkObserver.observe.mockResolvedValue(0);
		try {
			await crawler.crawl([], [], crawlState);
		} catch (e) {
			expect(e).toBeInstanceOf(Error);
			expect(crawlLogger.start).not.toHaveBeenCalled();
			expect(crawlLogger.stop).not.toHaveBeenCalled();
			expect(maxCrawlTimeManager.setTimer).not.toHaveBeenCalled();
			expect(maxCrawlTimeManager.clearTimer).not.toHaveBeenCalled();
		}
	});

	function expectCorrectMaxTimer(
		maxCrawlTimeManager: MockProxy<MaxCrawlTimeManager>
	) {
		expect(maxCrawlTimeManager.setTimer).toHaveBeenCalled();
		expect(maxCrawlTimeManager.clearTimer).toHaveBeenCalled();
	}

	function expectCorrectLogger(crawlLogger: MockProxy<CrawlLogger>) {
		expect(crawlLogger.start).toHaveBeenCalled();
		expect(crawlLogger.stop).toHaveBeenCalled();
	}

	it('should connect to top tier and not crawl if there are no nodes to be crawled', async () => {
		const {
			crawler,
			crawlState,
			networkObserver,
			crawlLogger,
			maxCrawlTimeManager
		} = setupSUT();
		networkObserver.observe.mockResolvedValue(1);
		networkObserver.stop.mockResolvedValue(
			new Observation([], mock<PeerNodeCollection>(), mock<CrawlState>())
		);
		const result = await crawler.crawl([], [], crawlState);
		expect(result).toEqual({
			closedLedgers: [],
			latestClosedLedger: {
				closeTime: new Date(0),
				localCloseTime: new Date(0),
				sequence: BigInt(0),
				value: ''
			},
			peers: new Map()
		});
		expectCorrectMaxTimer(maxCrawlTimeManager);
		expectCorrectLogger(crawlLogger);
		expect(networkObserver.stop).toHaveBeenCalled();
	});

	it('should connect to top tier and crawl peer nodes received from top tier', (resolve) => {
		const {
			crawler,
			crawlState,
			networkObserver,
			networkObserverEventEmitter,
			crawlLogger,
			maxCrawlTimeManager
		} = setupSUT();
		networkObserver.observe.mockImplementationOnce(() => {
			return new Promise((resolve) => {
				networkObserverEventEmitter.emit('peers', [['127.0.0.1', 11625]]);
				setTimeout(() => {
					resolve(1);
				}, 1);
			});
		});
		networkObserver.connectToNode.mockImplementation((address, port) => {
			return new Promise((resolve) => {
				const disconnectPayload: ClosePayload = {
					address: address + ':' + port,
					publicKey: 'A'
				};
				networkObserverEventEmitter.emit('disconnect', disconnectPayload);
				setTimeout(() => {
					resolve(undefined);
				}, 1);
			});
		});

		networkObserver.stop.mockResolvedValue(
			new Observation([], mock<PeerNodeCollection>(), mock<CrawlState>())
		);
		crawler
			.crawl([['peer', 2]], [['top', 1]], crawlState)
			.then((result) => {
				expect(result).toEqual({
					closedLedgers: [],
					latestClosedLedger: {
						closeTime: new Date(0),
						localCloseTime: new Date(0),
						sequence: BigInt(0),
						value: ''
					},
					peers: new Map()
				});
				expectCorrectMaxTimer(maxCrawlTimeManager);
				expectCorrectLogger(crawlLogger);
				expect(networkObserver.observe).toHaveBeenNthCalledWith(
					1,
					[['top', 1]],
					crawlState
				);
				expect(networkObserver.connectToNode).toHaveBeenCalledTimes(2);
				expect(crawlState.state).toBe(CrawlProcessState.IDLE);
				resolve();
			})
			.catch((e) => {
				throw e;
			});
	});

	it('should crawl nodes received from peers', (resolve) => {
		const {
			crawler,
			crawlState,
			networkObserver,
			crawlLogger,
			maxCrawlTimeManager,
			networkObserverEventEmitter
		} = setupSUT();
		networkObserver.observe.mockResolvedValue(1);
		networkObserver.stop.mockResolvedValue(
			new Observation([], mock<PeerNodeCollection>(), mock<CrawlState>())
		);
		networkObserver.connectToNode.mockImplementation((address, port) => {
			return new Promise((resolve) => {
				const disconnectPayload: ClosePayload = {
					address: address + ':' + port,
					publicKey: 'A'
				};
				networkObserverEventEmitter.emit('peers', [['otherPeer', 2]]);
				networkObserverEventEmitter.emit('disconnect', disconnectPayload);
				setTimeout(() => {
					resolve(undefined);
				}, 1);
			});
		});
		crawler
			.crawl([['peer', 2]], [['top', 1]], crawlState)
			.then((result) => {
				expect(result).toEqual({
					closedLedgers: [],
					latestClosedLedger: {
						closeTime: new Date(0),
						localCloseTime: new Date(0),
						sequence: BigInt(0),
						value: ''
					},
					peers: new Map()
				});
				expectCorrectMaxTimer(maxCrawlTimeManager);
				expectCorrectLogger(crawlLogger);
				expect(networkObserver.connectToNode).toHaveBeenCalledTimes(2);
				resolve();
			})
			.catch((e) => {
				throw e;
			});
	});
});
