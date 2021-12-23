[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)
[![test](https://github.com/stellarbeat/js-stellar-node-crawler/actions/workflows/test.yml/badge.svg)](https://github.com/stellarbeat/js-stellar-node-crawler/actions/workflows/test.yml)
# stellar-js-node-crawler

Crawl the Stellar Network. Identify the nodes and determine their validating status.

## How does it work?

### 1) Connecting
The crawler uses a seed list of nodes to start the crawling. Using the [node connector package](https://github.com/stellarbeat/js-stellar-node-connector) it connects to every node in the seed list.

### 2) Node discovery
When the crawler connects to a node, that node will send a list of [peer addresses](https://github.com/stellar/stellar-core/blob/9c33bcca29d0f7811199ed36a17d9fe457edf26c/src/xdr/Stellar-overlay.x#L58).
The crawler keeps connecting to new nodes it discovers until there are no more left. 

### 3) QuorumSets
To determine the quorumSet of a node, the crawler listens to every node for at least 6 seconds. When the node participates in consensus it will send [scp messages](https://github.com/stellar/stellar-core/blob/9b54f2d9ea38caac0eabbdd8817af3e262ac6a89/src/xdr/Stellar-SCP.x#L72) that contain its quorumSet hash. The crawler then sends a [GET_SCP_QUORUMSET](https://github.com/stellar/stellar-core/blob/9b54f2d9ea38caac0eabbdd8817af3e262ac6a89/src/xdr/Stellar-overlay.x#L87) message to retrieve the actual quorumSet.
If a node doesn't respond in time or sends a [DONT_HAVE message](https://github.com/stellar/stellar-core/blob/9b54f2d9ea38caac0eabbdd8817af3e262ac6a89/src/xdr/Stellar-overlay.x#L76), it tries with another node.

### 4) Validating status
To determine the validating status of a node, the crawler listens for [externalize messages](https://github.com/stellar/stellar-core/blob/9b54f2d9ea38caac0eabbdd8817af3e262ac6a89/src/xdr/Stellar-SCP.x#L59). An externalize message indicates that the node has closed a slot in its ledger.

A node is marked as validating when the closed slot is in line with the network. Meaning it closed the most recent slot (or is not far behind) and it closed the correct value.  

For the crawler to know what the most recent closed slot is, it relies on a set of trusted nodes. If the majority of its trusted nodes externalize a slot with a specific value, the crawler marks that slot as the latest. 

Every node sends not only its own SCP/externalize messages, but also relays the messages from the nodes in its own transitive quorumSet. These will include the messages of all the nodes in the _network_ transitive quorumSet, because by definition, these nodes are transitively trusted by every node in the network.
The crawler performs best if you select nodes from the _network_ transitive quorumSet as its trusted nodes (the nodes it needs to determine the latest ledger).
This way when the crawler connects and listens to any node in the network, the messages from the network transitive quorumSet will be relayed, and the crawler will be able to correctly determine if that node is validating.

By default, the crawler listens for 6 seconds to a node to determine its validating status. However, if the node is participating in consensus by sending other types of SCP messages, but no externalize messages it could indicate slower ledger close times. The crawler will wait another six seconds, and will repeat this process up to 100 seconds in total listening time. If no ledger is closed in 100 seconds, the node is marked as _not_ validating.  
This has an important consequence that the crawl time will increase together with ledger close times. Taking the most time in case the network is halted.

### 5) Peer nodes
The crawler returns a [PeerNode object](https://github.com/stellarbeat/js-stellar-node-crawler/blob/master/src/peer-node.ts) for every successful connection. 

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