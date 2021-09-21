import {isLedgerSequenceValid} from "../src/ledger-validator";
import {Ledger} from "../src/crawler";

it('should let valid ledger sequences pass', function () {
    const latestClosedLedger: Ledger = {
        sequence: BigInt("1"),
        closeTime: new Date()
    }
    expect(isLedgerSequenceValid(latestClosedLedger, BigInt("1"))).toBeTruthy();
    expect(isLedgerSequenceValid(latestClosedLedger, BigInt("2"))).toBeTruthy();
});

it('should not let too old ledger sequences pass', function () {
    const latestClosedLedger: Ledger = {
        sequence: BigInt("2"),
        closeTime: new Date("12/12/2009")
    }
    expect(isLedgerSequenceValid(latestClosedLedger, BigInt("2"))).toBeFalsy();
    expect(isLedgerSequenceValid(latestClosedLedger, BigInt("1"))).toBeFalsy();
});

it('should not let ledger sequences older then max seq drift pass', function () {
    const latestClosedLedger: Ledger = {
        sequence: BigInt("7"),
        closeTime: new Date()
    }

    expect(isLedgerSequenceValid(latestClosedLedger, BigInt("1"))).toBeFalsy();
});