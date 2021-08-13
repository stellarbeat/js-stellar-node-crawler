const Crawler = require("../lib").Crawler;
const jsonStorage = require('../lib').jsonStorage;
const blocked = require('blocked-at')

// noinspection JSIgnoredPromiseFromCall
main();

async function main() {
    blocked((time, stack) => {
        console.log(`Blocked for ${time}ms, operation started here:`, stack)
    }, {trimFalsePositives: true})

    if (process.argv.length <= 2) {
        console.log("Usage: " + __filename + " NODES.JSON_PATH ");

        process.exit(-1);
    }
    let nodesJsonPath = process.argv[2];

    console.log("[MAIN] Reading NODES.JSON_PATH");
    let nodes = await jsonStorage.getNodesFromFile(nodesJsonPath);

    console.log("[MAIN] Crawl!");
    let crawledNodes = [];
    let myCrawler = new Crawler(true, 40);

    try {
        crawledNodes = await myCrawler.crawl(nodes.filter(node => node.publicKey).map(node => [node.ip, node.port]));
    } catch (e) {
        console.log(e);
    }

    console.log("[MAIN] Writing results to file nodes.json in directory crawl_result");
    await jsonStorage.writeFilePromise("./crawl_result/nodes.json", JSON.stringify(crawledNodes.filter(node => node.publicKey)));

    console.log("[MAIN] Finished");
}