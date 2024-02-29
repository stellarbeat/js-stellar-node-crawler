import {QuorumSet} from "@stellarbeat/js-stellarbeat-shared";
import containsSlice from "@stellarbeat/js-stellarbeat-shared/lib/quorum/containsSlice";

it('should only take trusted validators into account to close slots', function () {
    const qSet = QuorumSet.fromBaseQuorumSet(JSON.parse("{\n" +
        "  \"threshold\": 2,\n" +
        "  \"validators\": [\n" +
        "    \"GDKXE2OZMJIPOSLNA6N6F2BVCI3O777I2OOC4BV7VOYUEHYX7RTRYA7Y\",\n" +
        "    \"GCUCJTIYXSOXKBSNFGNFWW5MUQ54HKRPGJUTQFJ5RQXZXNOLNXYDHRAP\",\n" +
        "    \"GC2V2EFSXN6SQTWVYA5EPJPBWWIMSD2XQNKUOHGEKB535AQE2I6IXV2Z\"\n" +
        "  ],\n" +
        "  \"innerQuorumSets\": []\n" +
        "}"));

    expect(QuorumSet.getAllValidators(qSet)).toEqual(["GDKXE2OZMJIPOSLNA6N6F2BVCI3O777I2OOC4BV7VOYUEHYX7RTRYA7Y", "GCUCJTIYXSOXKBSNFGNFWW5MUQ54HKRPGJUTQFJ5RQXZXNOLNXYDHRAP", "GC2V2EFSXN6SQTWVYA5EPJPBWWIMSD2XQNKUOHGEKB535AQE2I6IXV2Z"])
    expect(QuorumSet.getAllValidators(qSet).includes("GDKXE2OZMJIPOSLNA6N6F2BVCI3O777I2OOC4BV7VOYUEHYX7RTRYA7Y")).toBeTruthy();
    expect(QuorumSet.getAllValidators(qSet).includes("GCTFJFIQENN57XBWW7VJVEHEUABPDDKSMFLB244MERSFIMXJTORRAQBI")).toBeFalsy();
    expect(QuorumSet.getAllValidators(qSet).includes("")).toBeFalsy();

    const ledgerMap = new Map<bigint, string>();
    const ledgerA = BigInt(877396);
    ledgerMap.set(ledgerA, 'yes');
    const ledgerB = BigInt(1496126);
    ledgerMap.set(ledgerB, 'no');
    expect(ledgerMap.get(BigInt(877396))).toEqual('yes');
    expect(ledgerMap.get(BigInt(1496126))).toEqual('no');

    expect(help(qSet, "GCTFJFIQENN57XBWW7VJVEHEUABPDDKSMFLB244MERSFIMXJTORRAQBI")).toEqual(undefined);

});


function help(trustedQSet: QuorumSet, nodeId: string) {
    let externalizedValue: string | undefined = undefined;
    if (QuorumSet.getAllValidators(trustedQSet).includes(nodeId)) {
        if (containsSlice(trustedQSet, new Set()))
            //try to close slot
            externalizedValue = '1';
    }

    return externalizedValue;
}