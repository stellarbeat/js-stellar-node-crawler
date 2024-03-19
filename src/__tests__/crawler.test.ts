import { Crawler } from '../index';
import { createDummyCrawlerConfiguration } from '../__fixtures__/createDummyCrawlerConfiguration';
import { CrawlQueueManager } from '../crawl-queue-manager';
import { MaxCrawlTimeManager } from '../max-crawl-time-manager';
import { P } from 'pino';
import { mock, MockProxy } from 'jest-mock-extended';
import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { CrawlLogger } from '../crawl-logger';
import { CrawlProcessState } from '../crawl';
import { EventEmitter } from 'events';
import { AsyncCrawlQueue } from '../crawl-queue';
import { NetworkObserver } from '../network-observer/network-observer';
import { ClosePayload } from '../network-observer/connection-manager';
import { ObservationFactory } from '../network-observer/observation-factory';
import { CrawlFactory } from '../crawl-factory';
import { Observation } from '../network-observer/observation';

describe('Crawler', () => {
	const crawlFactory = new CrawlFactory(
		new ObservationFactory(),
		'test',
		mock<P.Logger>()
	);
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
		const crawl = crawlFactory.createCrawl(
			[['peer', 2]],
			[['top', 1]],
			new QuorumSet(2, []),
			{
				closeTime: new Date(0),
				localCloseTime: new Date(0),
				sequence: BigInt(0),
				value: ''
			},
			new Map()
		);

		return {
			crawler,
			crawl,
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
			crawl: crawl,
			networkObserver,
			crawlLogger,
			maxCrawlTimeManager
		} = setupSUT();
		networkObserver.startObservation.mockResolvedValue(0);
		crawl.observation.topTierAddresses = [];
		crawl.nodesToCrawl = [];
		try {
			await crawler.startCrawl(crawl);
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
			crawl: crawl,
			networkObserver,
			crawlLogger,
			maxCrawlTimeManager
		} = setupSUT();
		networkObserver.startObservation.mockResolvedValue(1);
		networkObserver.stop.mockResolvedValue(mock<Observation>());
		crawl.observation.topTierAddresses = [];
		crawl.nodesToCrawl = [];
		const result = await crawler.startCrawl(crawl);
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
			crawl: crawl,
			networkObserver,
			networkObserverEventEmitter,
			crawlLogger,
			maxCrawlTimeManager
		} = setupSUT();
		networkObserver.startObservation.mockImplementationOnce(() => {
			return new Promise((resolve) => {
				networkObserverEventEmitter.emit('peers', [['127.0.0.1', 11625]]);
				setTimeout(() => {
					resolve(1);
				}, 1);
			});
		});

		networkObserver.stop.mockResolvedValue(mock<Observation>());

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

		crawler
			.startCrawl(crawl)
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
				expect(networkObserver.startObservation).toHaveBeenNthCalledWith(
					1,
					crawl.observation
				);
				expect(networkObserver.connectToNode).toHaveBeenCalledTimes(2);
				expect(crawl.state).toBe(CrawlProcessState.IDLE);
				resolve();
			})
			.catch((e) => {
				throw e;
			});
	});

	it('should crawl nodes received from peers', (resolve) => {
		const {
			crawler,
			crawl,
			networkObserver,
			crawlLogger,
			maxCrawlTimeManager,
			networkObserverEventEmitter
		} = setupSUT();
		networkObserver.startObservation.mockResolvedValue(1);
		networkObserver.stop.mockResolvedValue(mock<Observation>());
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
			.startCrawl(crawl)
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
