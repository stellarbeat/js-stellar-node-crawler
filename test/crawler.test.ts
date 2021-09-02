import {Node as NetworkNode, getConfigFromEnv, Connection} from "@stellarbeat/js-stellar-node-connector";
import {Crawler} from "../src";
import {xdr} from "stellar-base";
import {QuorumSet} from "@stellarbeat/js-stellar-domain";

let peerNetworkNode: NetworkNode;
let peerNodeAddress: [ip: string, port: number];
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
    peerNetworkNode.on("connection", (connection: Connection) => {
        connection.on("connect", () => {
            console.log("Crawler contacted me!");
        });
        connection.on("data", (stellarMessage: xdr.StellarMessage) => {

        })
        connection.on("error", (error: Error) => console.log(error));
    });

    let qSet = new QuorumSet('hash', 2, [
        'GCGB2S2KGYARPVIA37HYZXVRM2YZUEXA6S33ZU5BUDC6THSB62LZSTYH', 'GABMKJM6I25XI4K7U6XWMULOUQIQ27BCTMLS6BYYSOWKTBUXVRJSXHYQ', 'GCM6QMP3DLRPTAZW2UZPCPX2LF3SXWXKPMP3GKFZBDSF3QZGV2G5QSTK'
    ]);
    let crawler = new Crawler(qSet,true, 20);
    let result = await crawler.crawl([peerNodeAddress]);
    let peerNode = result.pop()!;

    expect(peerNode.active).toBeTruthy();
    expect(peerNode.isValidating).toBeFalsy();
    expect(peerNode.overLoaded).toBeFalsy();
});