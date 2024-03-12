import { Crawler } from '../index';
import { createDummyCrawlerConfiguration } from '../__fixtures__/createDummyCrawlerConfiguration';
import { ClosePayload } from '../connection-manager';
import { CrawlQueueManager } from '../crawl-queue-manager';
import { MaxCrawlTimeManager } from '../max-crawl-time-manager';
import { PeerListener } from '../peer-listener/peer-listener';
import { P } from 'pino';
import { mock, MockProxy } from 'jest-mock-extended';
import { QuorumSet } from '@stellarbeat/js-stellarbeat-shared';
import { CrawlLogger } from '../crawl-logger';
import { CrawlState } from '../crawl-state';
import { EventEmitter } from 'events';
import { AsyncCrawlQueue } from '../crawl-queue';

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
		const peerListener = mock<PeerListener>();
		const crawlLogger = mock<CrawlLogger>();
		const logger = mock<P.Logger>();
		logger.child.mockReturnValue(logger as any);
		const peerListenerEventEmitter = new EventEmitter();

		peerListener.on.mockImplementation((event, listener) => {
			peerListenerEventEmitter.on(event, listener);
			return peerListener;
		});

		const crawler = new Crawler(
			createDummyCrawlerConfiguration(),
			crawlQueueManager,
			maxCrawlTimeManager,
			peerListener,
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
			peerListener,
			peerListenerEventEmitter,
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
			peerListener,
			crawlLogger,
			maxCrawlTimeManager
		} = setupSUT();
		peerListener.start.mockResolvedValue(0);
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
			peerListener,
			crawlLogger,
			maxCrawlTimeManager
		} = setupSUT();
		peerListener.start.mockResolvedValue(1);
		peerListener.stop.mockResolvedValue();
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
		expect(peerListener.stop).toHaveBeenCalled();
	});

	it('should connect to top tier and crawl peer nodes received from top tier', (resolve) => {
		const {
			crawler,
			crawlState,
			peerListener,
			peerListenerEventEmitter,
			crawlLogger,
			maxCrawlTimeManager
		} = setupSUT();
		peerListener.start.mockImplementationOnce(() => {
			return new Promise((resolve) => {
				peerListenerEventEmitter.emit('peers', [['127.0.0.1', 11625]]);
				setTimeout(() => {
					resolve(1);
				}, 1);
			});
		});
		peerListener.connectToNode.mockImplementation((address, port) => {
			return new Promise((resolve) => {
				const disconnectPayload: ClosePayload = {
					address: address + ':' + port,
					publicKey: 'A'
				};
				peerListenerEventEmitter.emit('disconnect', disconnectPayload);
				setTimeout(() => {
					resolve(undefined);
				}, 1);
			});
		});

		peerListener.stop.mockResolvedValue();
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
				expect(peerListener.start).toHaveBeenNthCalledWith(
					1,
					[['top', 1]],
					crawlState
				);
				expect(peerListener.connectToNode).toHaveBeenCalledTimes(2);
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
			peerListener,
			crawlLogger,
			maxCrawlTimeManager,
			peerListenerEventEmitter
		} = setupSUT();
		peerListener.start.mockResolvedValue(1);
		peerListener.stop.mockResolvedValue();
		peerListener.connectToNode.mockImplementation((address, port) => {
			return new Promise((resolve) => {
				const disconnectPayload: ClosePayload = {
					address: address + ':' + port,
					publicKey: 'A'
				};
				peerListenerEventEmitter.emit('peers', [['otherPeer', 2]]);
				peerListenerEventEmitter.emit('disconnect', disconnectPayload);
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
				expect(peerListener.connectToNode).toHaveBeenCalledTimes(2);
				resolve();
			})
			.catch((e) => {
				throw e;
			});
	});
});
