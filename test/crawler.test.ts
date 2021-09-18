import {
    Node as NetworkNode,
    Connection,
} from "@stellarbeat/js-stellar-node-connector";
import {CrawlerFactory} from "../src";
import {xdr, Keypair} from "stellar-base";
import {QuorumSet} from "@stellarbeat/js-stellar-domain";
import {NodeConfig} from "@stellarbeat/js-stellar-node-connector/lib/node-config";
import {NodeAddress} from "../src/crawler";

jest.setTimeout(10000);

let peerNodeAddress: NodeAddress;
let peerNetworkNode: NetworkNode;

let crawledPeerNetworkNode: NetworkNode;
let crawledPeerNodeAddress: NodeAddress;

beforeAll(() => {
    peerNodeAddress = ['127.0.0.1', 11621];
    peerNetworkNode = getListeningPeerNode(peerNodeAddress);
    crawledPeerNodeAddress = ['127.0.0.1', 11622];
    crawledPeerNetworkNode = getListeningPeerNode(crawledPeerNodeAddress);
})

afterAll((done) => {
    let counter = 0;

    let cleanup = () => {
        counter++;
        if (counter === 2) {
            done();
        }
    }
    peerNetworkNode.stopAcceptingIncomingConnections(cleanup);
    crawledPeerNetworkNode.stopAcceptingIncomingConnections(cleanup);
})

test('crawl', async () => {
    peerNetworkNode.on("connection", (connection: Connection) => {
        connection.on("connect", () => {
            console.log("Connect");
            let peerAddress = new xdr.PeerAddress({
                ip: xdr.PeerAddressIp.iPv4(Buffer.from([127, 0, 0, 1])),
                port: crawledPeerNodeAddress[1],
                numFailures: 0
            });
            let peers = xdr.StellarMessage.peers([
                peerAddress
            ])
            connection.sendStellarMessage(peers);
            let commit = new xdr.ScpBallot({counter: 1, value: Buffer.alloc(32)});
            let externalize = new xdr.ScpStatementExternalize({
                commit: commit,
                nH: 1,
                commitQuorumSetHash: Buffer.alloc(32)
            })
            let pledges = xdr.ScpStatementPledges.scpStExternalize(externalize);

            let statement = new xdr.ScpStatement(
                {
                    nodeId: xdr.PublicKey.publicKeyTypeEd25519(peerNetworkNode.keyPair.rawPublicKey()),
                    slotIndex: xdr.Uint64.fromString("1"),
                    pledges: pledges
                }
            )
            let envelope = new xdr.ScpEnvelope({statement: statement, signature: Buffer.alloc(32)})
            let message = xdr.StellarMessage.scpMessage(envelope);

            connection.sendStellarMessage(message, (error) => console.log(error));
        });
        connection.on("data", (stellarMessage: xdr.StellarMessage) => {

        })
        connection.on("error", (error: Error) => console.log(error));

        connection.on("close", () => {
        })
        connection.on("end", (error?: Error) => {
            connection.destroy(error);
        })
    });
    peerNetworkNode.on("close", () => {
        console.log("seed peer server close")
    })

    crawledPeerNetworkNode.on("connection", (connection: Connection) => {
        connection.on("connect", () => {
        });
        connection.on("data", (stellarMessage: xdr.StellarMessage) => {

        })
        connection.on("error", (error: Error) => console.log(error));

        connection.on("close", () => {
        })
        connection.on("end", (error?: Error) => {
            connection.destroy(error);
        })
    });
    crawledPeerNetworkNode.on("close", () => {
        console.log("crawled peer server close");
    })


    let qSet = new QuorumSet('hash', 2, [
        'GCGB2S2KGYARPVIA37HYZXVRM2YZUEXA6S33ZU5BUDC6THSB62LZSTYH', 'GABMKJM6I25XI4K7U6XWMULOUQIQ27BCTMLS6BYYSOWKTBUXVRJSXHYQ', 'GCM6QMP3DLRPTAZW2UZPCPX2LF3SXWXKPMP3GKFZBDSF3QZGV2G5QSTK'
    ]);
    let crawler = CrawlerFactory.createCrawler({usePublicNetwork: true, maxOpenConnections: 20});
    let result = await crawler.crawl([peerNodeAddress], qSet);
    let peerNode = result.peers.get(peerNetworkNode.keyPair.publicKey())!;

    expect(peerNode.successfullyConnected).toBeTruthy();
    expect(peerNode.isValidating).toBeTruthy();
    expect(peerNode.overLoaded).toBeFalsy();
    expect(peerNode.suppliedPeerList).toBeTruthy();
});

function getListeningPeerNode(address: NodeAddress) {
    let peerNodeConfig: NodeConfig = {
        nodeInfo: {
            ledgerVersion: 1,
            overlayMinVersion: 1,
            overlayVersion: 1,
            versionString: "1",
        },
        listeningPort: address[1],
        privateKey: Keypair.random().secret(),
        receiveSCPMessages: true,
        receiveTransactionMessages: false
    }
    let peerNetworkNode = new NetworkNode(true, peerNodeConfig);
    peerNetworkNode.acceptIncomingConnections(address[1], address[0]);

    return peerNetworkNode;
}