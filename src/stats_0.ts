import bigInt from 'big-integer';
import fs from 'fs';
import { JSONPath } from 'jsonpath-plus';
import * as fetch from 'node-fetch';

interface BalanceMap {
    [level: number]: {
        balance: string | number
    }
}

interface OperationInfo {
    hash: string,
    operator: string,
    input: 'coin' | 'token',
    amount: string | number
}

interface OperationMap {
    [level: number]: OperationInfo[];
}

interface ChainHistory {
    [contract: string]: {
        [level: number]: {
            timestamp: string,
            coinBalance: number | string,
            tokenBalance: number | string,
            totalSupply: number | string,
            operations: {
                [hash: string]:
                {
                    receiver: string,
                    input: 'coin' | 'token',
                    amount: string | number
                }
            }
        }
    }
}

const usdtzTokenAddress = 'KT1LN4LPSqTMS7Sd2CJw4bbDGRkMv2t68Fy9';
const usdtzTokenLedgerMapId = 36;
const querySize = 500;

// function getCashToTokenExchangeRate(cashAmount: string, tokenBalance: string, cashBalance: string) {
//     const n = bigInt(cashAmount).multiply(bigInt(tokenBalance)).multiply(bigInt(this._exchangeMultiplier));
//     const d = bigInt(cashBalance).multiply(bigInt(1000)).add(bigInt(cashAmount).multiply(bigInt(this._exchangeMultiplier))); // TODO: 1000

//     const tokenAmount = n.divide(d);
//     const dm = tokenAmount.divmod(bigInt(cashAmount));
//     const f = dm.remainder.multiply(bigInt(10 ** this._cashToken.tokenDecimals)).divide(bigInt(cashAmount));

//     return { tokenAmount: tokenAmount.toString(), rate: parseFloat(`${dm.quotient.toJSNumber()}.${f.toJSNumber()}`) };
// }

// function getTokenToCashExchangeRate(tokenAmount: string, tokenBalance: string, cashBalance: string) {
//     const n = bigInt(tokenAmount).multiply(bigInt(cashBalance)).multiply(bigInt(this._exchangeMultiplier));
//     const d = bigInt(tokenBalance)
//         .multiply(bigInt(1000))
//         .add(bigInt(tokenAmount).multiply(bigInt(this._exchangeMultiplier)));

//     const cashAmount = n.divide(d);
//     const dm = cashAmount.divmod(bigInt(tokenAmount));
//     const f = dm.remainder.multiply(bigInt(10 ** this._assetToken.tokenDecimals)).divide(bigInt(tokenAmount));

//     return { cashAmount: cashAmount.toString(), rate: parseFloat(`${dm.quotient.toJSNumber()}.${f.toJSNumber()}`) };
// }

function getCashToTokenExchangeRate(cashAmount: string, tokenBalance: string, cashBalance: string) {
    const n = bigInt(cashAmount).multiply(bigInt(tokenBalance));
    const d = bigInt(cashBalance).add(bigInt(cashAmount)); // TODO: 1000

    const tokenAmount = n.divide(d);
    const dm = tokenAmount.divmod(bigInt(cashAmount));
    const f = dm.remainder.multiply(bigInt(10 ** 6)).divide(bigInt(cashAmount));

    return { tokenAmount: tokenAmount.toString(), rate: parseFloat(`${dm.quotient.toJSNumber()}.${f.toJSNumber()}`) };
}

function getTokenToCashExchangeRate(tokenAmount: string, tokenBalance: string, cashBalance: string) {
    const n = bigInt(tokenAmount).multiply(bigInt(cashBalance));
    const d = bigInt(tokenBalance).add(bigInt(tokenAmount));

    const cashAmount = n.divide(d);
    const dm = cashAmount.divmod(bigInt(tokenAmount));
    const f = dm.remainder.multiply(bigInt(10 ** 6)).divide(bigInt(tokenAmount));

    return { cashAmount: cashAmount.toString(), rate: parseFloat(`${dm.quotient.toJSNumber()}.${f.toJSNumber()}`) };
}

async function getLastBlockLevel(): Promise<number> {
    const url = 'https://api.tzkt.io/v1/blocks/count';
    const result = await fetch(url, { method: 'GET', cache: 'no-cache' });
    const data = await result.text();

    return Number(data);

}

async function getContractTransactions(contract: string, entrypoints: string[], startBlock: number, endBlock: number) {
    const fields = ['level', 'hash', 'amount', 'parameter', 'sender', 'timestamp']; // 'initiator'
    const url = 'https://api.tzkt.io/v1/operations/transactions';
    const params = `target=${contract}&level.lt=${endBlock}&level.ge=${startBlock}&entrypoint.in=${entrypoints.join(',')}&sort=level&select=${fields.join(',')}&status=applied`;
    const result = await fetch(`${url}?${params}`, { method: 'GET', cache: 'no-cache' });
    const data = await result.json();
    // console.log('getContractTransactions', `${url}?${params}`, JSON.stringify(data));

    const operationHistory: OperationMap = {};
    for (const row of data) {
        if (operationHistory[row['level']] === undefined) { operationHistory[row['level']] = []; }
        if (row['amount'] === 0) {
            operationHistory[row['level']].push(
                {
                    hash: row['hash'],
                    operator: row['sender']['address'], // TODO: may need row['initiator']['address'] or a call param value
                    input: 'token',
                    amount: JSONPath({ path: '$.value.amount', json: row['parameter'] })[0]
                }
            )
        } else {
            operationHistory[row['level']].push(
                {
                    hash: row['hash'],
                    operator: row['sender']['address'], // TODO: may need row['initiator']['address'] or a call param value
                    input: 'coin',
                    amount: row['amount']
                }
            )
        }
    }

    return operationHistory;

    /*{
        "type": "transaction",
        "id": 467078514475008,
        "level": 3159531,
        "timestamp": "2023-02-19T13:37:44Z",
        "block": "BLhfUsZnzDUMU85mFWqjWnoSuYGMco1nZm5LjeppV3QL1iJ7Dsg",
        "hash": "oojMQqxLdgFqAj2YgJGFgngVNmhKMeRKVqExsSJ6JmztTRBEkFL",
        "counter": 72544713,
        "initiator": {
            "address": "tz1g7oWYSEArZE8MJFByFivRzVX6EBC4guA6"
        },
        "sender": {
            "address": "KT1JqfrRhXKjkA8Tu7LahWqzDFjsKRNSUtYh"
        },
        "senderCodeHash": 2119301288,
        "nonce": 75,
        "gasLimit": 0,
        "gasUsed": 2706,
        "storageLimit": 0,
        "storageUsed": 0,
        "bakerFee": 0,
        "storageFee": 0,
        "allocationFee": 0,
        "target": {
            "alias": "QuipuSwap USDtz",
            "address": "KT1WxgZ1ZSfMgmsSDDcUn8Xn577HwnQ7e1Lb"
        },
        "targetCodeHash": 572234294,
        "amount": 11234022,
        "parameter": {
            "entrypoint": "tezToTokenPayment",
            "value": {
                "min_out": "1",
                "receiver": "KT1JqfrRhXKjkA8Tu7LahWqzDFjsKRNSUtYh"
            }
        },
        "status": "applied",
        "hasInternals": false
    }
    
    {
        "type": "transaction",
        "id": 467078002769920,
        "level": 3159530,
        "timestamp": "2023-02-19T13:37:14Z",
        "block": "BL9pJ2YAB7u7hkLtWGUyH2RGJTDrgCHfEH178Kk27BnDKTNA6bi",
        "hash": "opSoJDNxdKce4N9tTBN6HPHyeBwit5M4h18a8xGXzBUYg7AiSbu",
        "counter": 18315084,
        "sender": {
            "address": "tz1TgQGVMnnNTzefWNFzTsYbJ5cEszNnbsQ7"
        },
        "gasLimit": 6853,
        "gasUsed": 2712,
        "storageLimit": 0,
        "storageUsed": 0,
        "bakerFee": 0,
        "storageFee": 0,
        "allocationFee": 0,
        "target": {
            "alias": "QuipuSwap USDtz",
            "address": "KT1WxgZ1ZSfMgmsSDDcUn8Xn577HwnQ7e1Lb"
        },
        "targetCodeHash": 572234294,
        "amount": 0,
        "parameter": {
            "entrypoint": "tokenToTezPayment",
            "value": {
                "amount": "117872713",
                "min_out": "96779711",
                "receiver": "tz1TgQGVMnnNTzefWNFzTsYbJ5cEszNnbsQ7"
            }
        },
        "status": "applied",
        "hasInternals": true
    }*/
}

/**
 * 
 * @param contract 
 * @param offset Ordinal record offset, not block level. 
 * @param length Maximum number of records to get
 * @returns 
 */
async function getContractBalanceHistory(contract: string, offset: number, length: number) {
    const url = `https://api.tzkt.io/v1/accounts/${contract}/balance_history`;
    const params = `step=1&limit=${length}&offset=${offset}`;
    const result = await fetch(`${url}?${params}`, { method: 'GET', cache: 'no-cache' });
    const data = await result.json();
    // console.log('getContractBalanceHistory', `${url}?${params}`, JSON.stringify(data));

    let balanceHistory: BalanceMap = {};
    for (const row of data) {
        balanceHistory[row['level']] = row['balance'];
    }

    return balanceHistory;
}

/**
 * 
 * @param contract 
 * @param startBlock 
 * @param length 
 * @returns 
 */
async function getContractTokenHistory(contract: string, startBlock: number, length: number) {
    const url = `https://api.tzkt.io/v1/bigmaps/${usdtzTokenLedgerMapId}/keys/${contract}/updates`;
    const params = `offset=${startBlock}&limit=${length}`;
    const result = await fetch(`${url}?${params}`, { method: 'GET', cache: 'no-cache' });
    const data = await result.json();
    // console.log('getContractTokenHistory', `${url}?${params}`, JSON.stringify(data));

    let balanceHistory: BalanceMap = {};
    for (const row of data) {
        if (row['action'] !== 'update_key') { continue; }

        balanceHistory[row['level']] = row['value']['balance'];
    }

    return balanceHistory;
}

async function getSupplyHistory(contract: string, offset: number, length: number): Promise<BalanceMap> {
    const url = `https://api.tzkt.io/v1/contracts/${contract}/storage/history`;
    const params = `lastId=${offset}&limit=${length}`;
    const result = await fetch(`${url}?${params}`, { method: 'GET', cache: 'no-cache' });
    const data = await result.json();
    // console.log('getSupplyHistory', `${url}?${params}`, JSON.stringify(data));

    let balanceHistory: BalanceMap = {};
    for (const row of data) {
        balanceHistory[row['level']] = JSONPath({ path: '$.totalSupply', json: row['value'] })[0];
    }

    return balanceHistory;
}

function exportSupplySeries(chainHistory: ChainHistory, contract: string, skip = true) {
    let series = '';

    const keys = Object.keys(chainHistory[contract]).sort((a, b) => Number(a) - Number(b));
    let previousSupply = 0;
    for (const level of keys) {
        let currentSupply = previousSupply;
        if (chainHistory[contract][level]['totalSupply'] !== undefined) {
            currentSupply = chainHistory[contract][level]['totalSupply'];
            previousSupply = currentSupply;
        } else if (skip) {
            continue;
        }

        series += `${level},${currentSupply}\n`;
    }

    fs.writeFileSync('supply.csv', series);
}

function exportYieldSeries(chainHistory: ChainHistory, contract: string) {
    const keys = Object.keys(chainHistory[contract]).sort((a, b) => Number(a) - Number(b));
    let previousLevel = 0;
    for (const level of keys) {
        try {
        if (chainHistory[contract][level]['operations'] === undefined || chainHistory[contract][level]['operations'].length === 0) {
            previousLevel = Number(level);
            continue;
        }

        let previousCoinBalance = chainHistory[contract][previousLevel].coinBalance;
        let previousTokenBalance = chainHistory[contract][previousLevel].tokenBalance;

        if (previousCoinBalance === undefined && previousTokenBalance !== undefined) {
            let levelIndex = keys.indexOf(`${previousLevel}`);
            const limit = Math.max(levelIndex - 10, 0);
            while (levelIndex > limit) {
                if (previousTokenBalance === chainHistory[contract][keys[levelIndex]].tokenBalance && chainHistory[contract][keys[levelIndex]].coinBalance !== undefined) {
                    previousCoinBalance = chainHistory[contract][previousLevel].coinBalance;
                    break;
                }
                --levelIndex;
            }

            if (previousCoinBalance === undefined) {
                console.log(`missing previousCoinBalance at ${level}`);
                continue;
            }
        } else if(previousCoinBalance !== undefined && previousTokenBalance === undefined) {
            let levelIndex = keys.indexOf(`${previousLevel}`);
            const limit = Math.max(levelIndex - 10, 0);
            while (levelIndex > limit) {
                if (previousCoinBalance === chainHistory[contract][keys[levelIndex]].coinBalance && chainHistory[contract][keys[levelIndex]].tokenBalance !== undefined) {
                    previousTokenBalance = chainHistory[contract][previousLevel].tokenBalance;
                    break;
                }
                --levelIndex;
            }

            if (previousTokenBalance === undefined) {
                console.log(`missing previousTokenBalance at ${level}`);
                continue;
            }
        }

        const currentCoinBalance = chainHistory[contract][level].coinBalance;
        const currentTokenBalance = chainHistory[contract][level].tokenBalance;
        let expectedCoinDiff = 0;
        let expectedTokenDiff = 0;
        for (const hash of Object.keys(chainHistory[contract][level]['operations'])) { // TODO: need to account for intra-block liquidity changes
            const operation = chainHistory[contract][level]['operations'][hash];
            if (operation.input === 'token') {
                const expectedResult = getTokenToCashExchangeRate(operation.amount.toString(), previousTokenBalance.toString(), previousCoinBalance.toString());
                expectedCoinDiff += -Number(expectedResult.cashAmount);
                expectedTokenDiff += Number(operation.amount);
            } else {
                const expectedResult = getCashToTokenExchangeRate(operation.amount.toString(), previousTokenBalance.toString(), previousCoinBalance.toString());
                expectedTokenDiff += -Number(expectedResult.tokenAmount);
                expectedCoinDiff += Number(operation.amount);
            }
        }
        // sample blocks 1435800, 1435804


        /*
        1435804

        coin: 246030659 - 240957207 = 5073452
        token: 1547023489 - 1579694714 = -32671225, 32671225

         5.073452c
        10.161854c
        */
       /*
       1435832

       coin: 240957207 - 239973929 = 983278
       token: 1579694714 - 1586186896 = -6492182, 6492182
       */

        const coinRevenue = Number(currentCoinBalance) - Number(previousCoinBalance) - expectedCoinDiff;
        const tokenRevenue = Number(currentTokenBalance) - Number(previousTokenBalance) - expectedTokenDiff;

        // console.log(`revenue at ${level}: ${coinRevenue}c, ${tokenRevenue}t on ${expectedCoinDiff}c, ${expectedTokenDiff}t`)

        console.log(`${level} from ${previousLevel}`);
        console.log(`starting ${previousCoinBalance}c, ${previousTokenBalance}t`);
        console.log(`ending   ${currentCoinBalance}c, ${currentTokenBalance}t`);
        console.log(`diff ${Number(currentCoinBalance) - Number(previousCoinBalance)}c, ${Number(currentTokenBalance) - Number(previousTokenBalance)}t`);
        console.log(`exp  ${expectedCoinDiff}c, ${expectedTokenDiff}t`)
        console.log(`revenue ${coinRevenue}c, ${tokenRevenue}t`)

        previousLevel = Number(level);
        // 1435804
        // starting 246030659c, 1547023489t
        // ending   240957207c, 1579694714t
        // diff -5073452c, 32671225t
        // exp  -5088402c, 32671225t
        //revenue 14950c, 0t
    } catch (err) {
        console.log(`exportYieldSeries failed at ${level}`);
        throw err;
    }
    }
}

async function run() {
    const contracts = [
        {
            name: 'QuipuSwap USDtz',
            address: 'KT1WxgZ1ZSfMgmsSDDcUn8Xn577HwnQ7e1Lb',
            deploymentBlock: 1434933,
            entrypoints: ['tezToTokenPayment', 'tokenToTezPayment']

            // JSONpaths
            // history file path
        }
    ];

    // const head = await getLastBlockLevel();
    const head = 1434933 + 3000;

    let chainHistory: ChainHistory = {};

    try {
        chainHistory = JSON.parse(fs.readFileSync('./chainHistory.json').toString());
    } catch { }

    // for (const contract of contracts) {
    //     let queryStartBlock = contract.deploymentBlock;
    //     let coinQueryOffset = 0;
    //     let tokenQueryOffset = 0;
    //     let supplyQueryOffset = 0;
    //     if (chainHistory[contract.address] === undefined) {
    //         chainHistory[contract.address] = {};
    //     } else {
    //         const recordedBlocks = Object.keys(chainHistory[contract.address]).sort();

    //         queryStartBlock = -1;
    //         coinQueryOffset = -1;
    //         tokenQueryOffset = -1;
    //         supplyQueryOffset = -1;

    //         for (let i = recordedBlocks.length - 1; i >= 0; i--) {
    //             const record = chainHistory[contract.address][recordedBlocks[i]];

    //             if (queryStartBlock < 0 && record['operations'] !== undefined && Object.keys(record['operations']).length > 0) {
    //                 queryStartBlock = Number(recordedBlocks[i]);
    //             }

    //             if (coinQueryOffset < 0 && record['coinBalance'] !== undefined) {
    //                 coinQueryOffset = i - 1;
    //             }

    //             if (tokenQueryOffset < 0 && record['tokenBalance'] !== undefined) {
    //                 tokenQueryOffset = i - 1;
    //             }

    //             if (supplyQueryOffset < 0 && record['totalSupply'] !== undefined) {
    //                 supplyQueryOffset = i - 1; // TODO: these need to be calculated separately based on counts of 'totalSupply' instances
    //             }

    //             if (queryStartBlock > 0 && coinQueryOffset > 0 && tokenQueryOffset > 0 && supplyQueryOffset > 0) { break; }

    //             if (i == 0) {
    //                 queryStartBlock = Math.max(queryStartBlock, 0);
    //                 coinQueryOffset = Math.max(coinQueryOffset, 0);
    //                 tokenQueryOffset = Math.max(tokenQueryOffset, 0);
    //                 supplyQueryOffset = Math.max(supplyQueryOffset, 0);
    //             }
    //         }

    //         console.log(`found existing data for ${contract.address}: ${queryStartBlock}, ${coinQueryOffset}, ${tokenQueryOffset}, ${supplyQueryOffset}`);
    //     }

    //     while (queryStartBlock < head) {
    //         const supplyHistory = await getSupplyHistory(usdtzTokenAddress, supplyQueryOffset, querySize);
    //         const coinHistory = await getContractBalanceHistory(contract.address, coinQueryOffset, querySize);
    //         const tokenHistory = await getContractTokenHistory(contract.address, tokenQueryOffset, querySize);
    //         const operationHistory = await getContractTransactions(contract.address, contract.entrypoints, queryStartBlock, queryStartBlock + querySize);

    //         Object.keys(supplyHistory).map(level => {
    //             if (chainHistory[contract.address][level] === undefined) {
    //                 chainHistory[contract.address][level] = {}
    //             };

    //             chainHistory[contract.address][level].totalSupply = supplyHistory[level];
    //         });

    //         Object.keys(coinHistory).map(level => {
    //             if (chainHistory[contract.address][level] === undefined) {
    //                 chainHistory[contract.address][level] = {}
    //             };

    //             chainHistory[contract.address][level].coinBalance = coinHistory[level];
    //         });

    //         Object.keys(tokenHistory).map(level => {
    //             if (chainHistory[contract.address][level] === undefined) {
    //                 chainHistory[contract.address][level] = {}
    //             };

    //             chainHistory[contract.address][level].tokenBalance = tokenHistory[level];
    //         });

    //         Object.keys(operationHistory).map(level => {
    //             if (chainHistory[contract.address][level] === undefined) {
    //                 chainHistory[contract.address][level] = {}
    //             };

    //             const levelOperations = operationHistory[level];
    //             chainHistory[contract.address][level].operations = {};
    //             for (const operation of levelOperations) {
    //                 chainHistory[contract.address][level].operations[operation.hash] = {
    //                     receiver: operation.operator,
    //                     input: operation.input,
    //                     amount: operation.amount
    //                 }
    //             }
    //         });

    //         queryStartBlock = Math.min(queryStartBlock + querySize, head);
    //         coinQueryOffset += querySize;
    //         tokenQueryOffset += querySize;
    //     }

    // }

    // fs.writeFileSync('./chainHistory.json', JSON.stringify(chainHistory, undefined, 4));

    // exportSupplySeries(chainHistory, 'KT1WxgZ1ZSfMgmsSDDcUn8Xn577HwnQ7e1Lb');
    exportYieldSeries(chainHistory, 'KT1WxgZ1ZSfMgmsSDDcUn8Xn577HwnQ7e1Lb');
    /*
- for each contract
    - get xtz balance history
    - get usdtz balance history
    - get contract transactions
    - 
- record total supply
    */
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});


// https://api.tzkt.io/#operation/BigMaps_GetBigMapUpdates

const log = [
    {
        "block": 0,
        "kt1...": {
            "usdtz": 0,
            "xtz": 0,
            "operations": [
                {
                    "hash": "",
                    "input": "xtz|usdtz",
                    "amount": ""
                }
            ]
        }
    }
]