import {xdr} from "stellar-base";

//we only take confirm and externalize messages into account
export function isNewerConsensusStatement(statementToCheck: xdr.ScpStatement, oldStatement?: xdr.ScpStatement): boolean {
    if (statementToCheck.pledges().switch() === xdr.ScpStatementType.scpStExternalize()) {
        return true;
    }

    if (statementToCheck.pledges().switch() === xdr.ScpStatementType.scpStConfirm()) {
        if(!oldStatement) {
            return true;
        }

        if (oldStatement.pledges().switch() === xdr.ScpStatementType.scpStExternalize()) {
            return false;
        }

        if (oldStatement.pledges().switch() === xdr.ScpStatementType.scpStConfirm()) {
            return isNewerConfirmStatement(statementToCheck.pledges().confirm(), oldStatement.pledges().confirm());
        }

        return false;
    }

    return false;
}

function isNewerConfirmStatement(statementToCheck: xdr.ScpStatementConfirm, oldStatement: xdr.ScpStatementConfirm): boolean {
    const result = compareBallots(oldStatement.ballot(), statementToCheck.ballot());
    if (result < 0)
    {
       return true;
    }
    else if (result == 0)
    {
        if (oldStatement.nPrepared() == statementToCheck.nPrepared())
        {
            return (oldStatement.nH() < statementToCheck.nH());
        }
        else
        {
            return (oldStatement.nPrepared() < statementToCheck.nPrepared());
        }
    }

    return false
}

function compareBallots(b1: xdr.ScpBallot, b2: xdr.ScpBallot): number {
    if (b1.counter() < b2.counter())
    {
        return -1;
    }
    else if (b2.counter() < b1.counter())
    {
        return 1;
    }

    if (b1.value() < b2.value())
    {
        return -1;
    }
    else if (b2.value() < b1.value())
    {
        return 1;
    }
    else
    {
        return 0;
    }
}
