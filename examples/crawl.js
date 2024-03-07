const jsonStorage = require('../lib').jsonStorage;
const blocked = require('blocked-at');
const { QuorumSet } = require('@stellarbeat/js-stellarbeat-shared');
const { createCrawler } = require('../lib');
const { getConfigFromEnv } = require('@stellarbeat/js-stellar-node-connector');

// noinspection JSIgnoredPromiseFromCall
main();

async function main() {
	if (process.argv.length <= 2) {
		console.log('Usage: ' + __filename + ' NODES.JSON_PATH ');

		process.exit(-1);
	}
	let nodesJsonPath = process.argv[2];

	console.log('[MAIN] Reading NODES.JSON_PATH');
	let nodes = await jsonStorage.getNodesFromFile(nodesJsonPath);

	console.log('[MAIN] Crawl!');
	let topTierQSet = new QuorumSet(15, [
		'GCVJ4Z6TI6Z2SOGENSPXDQ2U4RKH3CNQKYUHNSSPYFPNWTLGS6EBH7I2',
		'GCIXVKNFPKWVMKJKVK2V4NK7D4TC6W3BUMXSIJ365QUAXWBRPPJXIR2Z',
		'GBLJNN3AVZZPG2FYAYTYQKECNWTQYYUUY2KVFN2OUKZKBULXIXBZ4FCT',
		'GD5QWEVV4GZZTQP46BRXV5CUMMMLP4JTGFD7FWYJJWRL54CELY6JGQ63',
		'GDXQB3OMMQ6MGG43PWFBZWBFKBBDUZIVSUDAZZTRAWQZKES2CDSE5HKJ',
		'GCFONE23AB7Y6C5YZOMKUKGETPIAJA4QOYLS5VNS4JHBGKRZCPYHDLW7',
		'GA7TEPCBDQKI7JQLQ34ZURRMK44DVYCIGVXQQWNSWAEQR6KB4FMCBT7J',
		'GA5STBMV6QDXFDGD62MEHLLHZTPDI77U3PFOD2SELU5RJDHQWBR5NNK7',
		'GCMSM2VFZGRPTZKPH5OABHGH4F3AVS6XTNJXDGCZ3MKCOSUBH3FL6DOB',
		'GA7DV63PBUUWNUFAF4GAZVXU2OZMYRATDLKTC7VTCG7AU4XUPN5VRX4A',
		'GARYGQ5F2IJEBCZJCBNPWNWVDOFK7IBOHLJKKSG2TMHDQKEEC6P4PE4V',
		'GC5SXLNAM3C4NMGK2PXK4R34B5GNZ47FYQ24ZIBFDFOCU6D4KBN4POAE',
		'GBJQUIXUO4XSNPAUT6ODLZUJRV2NPXYASKUBY4G5MYP3M47PCVI55MNT',
		'GAK6Z5UVGUVSEK6PEOCAYJISTT5EJBB34PN3NOLEQG2SUKXRVV2F6HZY',
		'GD6SZQV3WEJUH352NTVLKEV2JM2RH266VPEM7EH5QLLI7ZZAALMLNUVN',
		'GAZ437J46SCFPZEDLVGDMKZPLFO77XJ4QVAURSJVRZK2T5S7XUFHXI2Z',
		'GADLA6BJK6VK33EM2IDQM37L5KGVCY5MSHSHVJA4SCNGNUIEOTCR6J5T',
		'GCM6QMP3DLRPTAZW2UZPCPX2LF3SXWXKPMP3GKFZBDSF3QZGV2G5QSTK',
		'GCGB2S2KGYARPVIA37HYZXVRM2YZUEXA6S33ZU5BUDC6THSB62LZSTYH',
		'GABMKJM6I25XI4K7U6XWMULOUQIQ27BCTMLS6BYYSOWKTBUXVRJSXHYQ',
		'GAYXZ4PZ7P6QOX7EBHPIZXNWY4KCOBYWJCA4WKWRKC7XIUS3UJPT6EZ4',
		'GAVXB7SBJRYHSG6KSQHY74N7JAFRL4PFVZCNWW2ARI6ZEKNBJSMSKW7C',
		'GAAV2GCVFLNN522ORUYFV33E76VPC22E72S75AQ6MBR5V45Z5DWVPWEU'
	]);

	let myCrawler = createCrawler({
		nodeConfig: getConfigFromEnv(),
		maxOpenConnections: 100,
		maxCrawlTime: 900000,
		blackList: new Set()
	});

	try {
		let knownQuorumSets = new Map();
		nodes.forEach((node) => {
			knownQuorumSets.set(node.quorumSetHashKey, node.quorumSet);
		});
		const addresses = nodes
			.filter((node) => node.publicKey)
			.map((node) => [node.ip, node.port]);

		const topTierAddresses = nodes
			.filter((node) => topTierQSet.validators.includes(node.publicKey))
			.map((node) => [node.ip, node.port]);

		let result = await myCrawler.crawl(
			addresses,
			topTierQSet,
			topTierAddresses,
			{
				sequence: BigInt(0),
				closeTime: new Date(0)
			},
			knownQuorumSets
		);
		console.log(
			'[MAIN] Writing results to file nodes.json in directory crawl_result'
		);
		await jsonStorage.writeFilePromise(
			'./crawl_result/nodes.json',
			JSON.stringify(Array.from(result.peers.values()))
		);

		console.log('[MAIN] Finished');
	} catch (e) {
		console.log(e);
	}
}
