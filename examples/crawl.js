const Crawler = require("../lib/index").Crawler;
const jsonStorage = require("../lib/index").jsonStorage;

// noinspection JSIgnoredPromiseFromCall
main();

async function main() {

    if (process.argv.length <= 2) {
        console.log("Usage: " + __filename + " NODES.JSON_PATH ");

        process.exit(-1);
    }
    let nodesJsonPath = process.argv[2];

    console.log("[MAIN] Reading NODES.JSON_PATH");
    let nodes = await jsonStorage.getNodesFromFile(nodesJsonPath);

    console.log("[MAIN] Crawl!");
    let myCrawler = new Crawler(true, 3000);
    let crawledNodes = await myCrawler.crawl(nodes.filter(node => node.publicKey));

    console.log("[MAIN] Writing results to file nodes.json in directory crawl_result");
    await jsonStorage.writeFilePromise("./crawl_result/nodes.json", JSON.stringify(crawledNodes.filter(node => node.publicKey)));

    console.log("[MAIN] Finished");
}