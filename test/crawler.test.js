const Node = require('@stellarbeat/js-stellar-domain').Node;
const ConnectionManager = require("@stellarbeat/js-stellar-node-connector").ConnectionManager;
const Crawler = require("../lib/crawler");
jest.mock("../node_modules/@stellarbeat/js-stellar-node-connector/lib/connection-manager.js");

//setup
let crawler;
beforeEach(() => {
    crawler = new Crawler(true, 1000);
});
afterEach(() => {
    crawler = undefined;
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
    expect(crawler.processCrawlQueue.mock.calls.length).toBe(2);
    expect(crawler._allNodes.size).toEqual(2);
    expect(crawler._allNodes.get('123:11625')).toEqual(node1);
    expect(crawler._busyCounter).toEqual(2);
});

test('processQueue', () => {
});