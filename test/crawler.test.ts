import {Node} from '@stellarbeat/js-stellar-domain';
import {ConnectionManager} from "@stellarbeat/js-stellar-node-connector";
import {Crawler} from "../src/crawler";
jest.mock("../node_modules/@stellarbeat/js-stellar-node-connector/lib/connection-manager.js");

//setup
let crawler:Crawler;
beforeEach(() => {
    crawler = new Crawler(true, 1000);
});

test('constructor', () => {

    expect(ConnectionManager).toHaveBeenCalledTimes(1); //constructor
});

test('crawlSingleNode', () => {
    let node1 = new Node('123');
    let node2 = new Node('234');
    crawler.processCrawlQueue = jest.fn();
    crawler.crawlNode(node1);
    crawler.crawlNode(node2);

    expect(crawler._nodesToCrawl.length).toEqual(2);
    expect(crawler._nodesToCrawl[0]).toEqual(node1);
    //@ts-ignore
    expect(crawler.processCrawlQueue.mock.calls.length).toBe(2);
    expect(Array.from(crawler._publicKeyToNodeMap.values()).length).toEqual(2);
    expect(crawler._publicKeyToNodeMap.get('123')).toEqual(node1);
    expect(crawler._busyCounter).toEqual(2);
});

test('processQueue', () => {
});