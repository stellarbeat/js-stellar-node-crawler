import {Node as NetworkNode, getConfigFromEnv} from "@stellarbeat/js-stellar-node-connector";
import {Crawler, PeerNode} from "../src";
import {xdr} from "stellar-base";

let peerNetworkNode: NetworkNode;
let peerNodeAddress: [ip:string, port:number];
jest.setTimeout(10000);
beforeAll(() => {
    peerNodeAddress = ['127.0.0.1', 11623];
    peerNetworkNode = new NetworkNode(true, getConfigFromEnv());
    peerNetworkNode.acceptIncomingConnections(peerNodeAddress[1], peerNodeAddress[0]);
})
afterAll(() => {
    peerNetworkNode.stopAcceptingIncomingConnections();
})

test('crawl', async () => {
    peerNetworkNode.on("connection", (connection) => {
        connection.on("connect", () => {
            console.log("Crawler contacted me!");
        });
        connection.on("data", (stellarMessage: xdr.StellarMessage) => {

        })
        connection.on("error", (error: Error) => console.log(error));
    });

    let crawler = new Crawler(true, 20);
    let result = await crawler.crawl([peerNodeAddress]);
    let peerNode = result.pop()!;
    expect(peerNode.active).toBeTruthy();
    expect(peerNode.isValidating).toBeFalsy();
    expect(peerNode.overLoaded).toBeFalsy();
});