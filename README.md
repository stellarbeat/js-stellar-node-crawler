[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)
[![test](https://github.com/stellarbeat/js-stellar-node-crawler/actions/workflows/test.yml/badge.svg)](https://github.com/stellarbeat/js-stellar-node-crawler/actions/workflows/test.yml)
# stellar-js-node-crawler

Crawl the Stellar Network. Identify the nodes and determine their validating status, version, lag,....

## How does it work?
See readme in src/README.md for an overview of the functionality and architecture.

## install
`yarn install`

## build code
`yarn run build`: builds code in lib folder

## Usage 
### Create crawler
```
let myCrawler = createCrawler({
    nodeConfig: getConfigFromEnv(),
    maxOpenConnections: 25,
    maxCrawlTime: 900000
});
```

The crawler is itself a [node](https://github.com/stellarbeat/js-stellar-node-connector) and needs to be configured accordingly. You can limit the number of simultaneous open connections to not overwhelm your server
and set the maxCrawlTime as a safety if the crawler should be stuck.

### Run crawl
```
let result = await myCrawler.crawl(
			nodes, // [[ip, port], [ip, port]]
			trustedQSet, //a quorumSet the crawler uses the determine the latest closed ledger
		    latestKnownLedger //a previous detected ledger the crawler can use to ignore older externalize messages	
		);
```

### example script

Check out `examples/crawl.js` for an example on how to crawl the network. You can try it out using the bundled seed file with the following command:  
`yarn run examples:crawl seed/nodes.json`

Another example is the [Stellarbeat backend](https://github.com/stellarbeat/js-stellarbeat-backend/blob/master/src/network/services/CrawlerService.ts)

### publish new release
Uses the [np package](https://github.com/sindresorhus/np) and semantic versioning.
```
np
```