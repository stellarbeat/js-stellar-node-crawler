const Crawler = require("../lib").Crawler;
const jsonStorage = require('../lib').jsonStorage;
const blocked = require('blocked-at')
const {QuorumSet} = require("@stellarbeat/js-stellar-domain");

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
    let activePeerNodes = [];
    let qSet = new QuorumSet('hash', 2, [
        'GCGB2S2KGYARPVIA37HYZXVRM2YZUEXA6S33ZU5BUDC6THSB62LZSTYH', 'GABMKJM6I25XI4K7U6XWMULOUQIQ27BCTMLS6BYYSOWKTBUXVRJSXHYQ', 'GCM6QMP3DLRPTAZW2UZPCPX2LF3SXWXKPMP3GKFZBDSF3QZGV2G5QSTK'
    ]);
    let myCrawler = new Crawler(qSet, true, 80);


    try {
        activePeerNodes = await myCrawler.crawl(nodes.filter(node => node.publicKey).map(node => [node.ip, node.port]));
    } catch (e) {
        console.log(e);
    }

    console.log("[MAIN] Writing results to file nodes.json in directory crawl_result");
    await jsonStorage.writeFilePromise("./crawl_result/nodes.json", JSON.stringify(activePeerNodes));

    console.log("[MAIN] Finished");
}