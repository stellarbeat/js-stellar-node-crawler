import {Node as NetworkNode, getConfigFromEnv} from "@stellarbeat/js-stellar-node-connector";
import {Crawler} from "../src";
import {xdr} from "stellar-base";
import {Node} from "@stellarbeat/js-stellar-domain";

let peerNodeData: Node;
let peerNode: NetworkNode;

beforeAll(() => {
    peerNodeData = new Node('PEER', '127.0.0.1', 11623)
    peerNode = new NetworkNode(true, getConfigFromEnv());
    peerNode.acceptIncomingConnections(peerNodeData.port, peerNodeData.ip);
})
afterAll(() => {
    peerNode.stopAcceptingIncomingConnections();
})

test('crawl', (done) => {
    peerNode.on("connection", (connection) => {
        connection.on("connect", () => {
            console.log("Crawler contacted me!");
            done();
        });
        connection.on("data", (stellarMessage: xdr.StellarMessage) => {

        })
        connection.on("error", (error: Error) => console.log(error));
    });

    let crawler = new Crawler(true, 20);
    crawler.crawl([peerNodeData]);
});