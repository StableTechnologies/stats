import bigInt from 'big-integer';
import fs from 'fs';
import { JSONPath } from 'jsonpath-plus';
import * as fetch from 'node-fetch';

interface ContractInfo {
    name: string;
    address: string;
    deploymentBlock: string | number;
    entrypoints: string[];
}

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
            price: number,
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

        if (['investLiquidity', 'divestLiquidity'].includes(row['parameter']['entrypoint'])) {
            continue;
        }

        if (row['amount'] === 0) { // tezToTokenPayment
            operationHistory[row['level']].push(
                {
                    hash: row['hash'],
                    operator: row['sender']['address'], // TODO: may need row['initiator']['address'] or a call param value
                    input: 'token',
                    amount: JSONPath({ path: '$.value.amount', json: row['parameter'] })[0]
                }
            )
        } else { // tokenToTezPayment
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


async function importCoinBalanceHistory(chainHistory: ChainHistory, contract: string, limit: string | number): Promise<ChainHistory> {
    let coinQueryOffset = 0;
    let lastRecodedBlock = 0;
    if (chainHistory[contract] === undefined) {
        chainHistory[contract] = {};
    } else {
        const recordedBlocks = Object.keys(chainHistory[contract]).sort((a, b) => Number(a) - Number(b));

        coinQueryOffset = -1;

        for (let i = recordedBlocks.length - 1; i >= 0; i--) {
            const record = chainHistory[contract][recordedBlocks[i]];

            if (coinQueryOffset < 0 && record['coinBalance'] !== undefined) {
                coinQueryOffset = i - 1;
                lastRecodedBlock = Number(recordedBlocks[i]);
                break;
            }
        }

        coinQueryOffset = Math.max(coinQueryOffset, 0);

        console.log(`found existing coin balance data for ${contract}: ${coinQueryOffset}, ${lastRecodedBlock}`);
    }

    while (lastRecodedBlock < limit) {
        const coinHistory = await getContractBalanceHistory(contract, coinQueryOffset, querySize);
        if (Object.keys(coinHistory).length === 0) { break; }

        Object.keys(coinHistory).map(level => {
            if (chainHistory[contract][level] === undefined) {
                chainHistory[contract][level] = {};
            };

            chainHistory[contract][level].coinBalance = coinHistory[level];
            lastRecodedBlock = Math.max(lastRecodedBlock, Number(level));
        });

        coinQueryOffset += querySize;
    }

    return chainHistory;
}

async function importTokenBalanceHistory(chainHistory: ChainHistory, contract: string, limit: string | number): Promise<ChainHistory> {
    let tokenQueryOffset = 0;
    let lastRecodedBlock = 0;
    if (chainHistory[contract] === undefined) {
        chainHistory[contract] = {};
    } else {
        const recordedBlocks = Object.keys(chainHistory[contract]).sort((a, b) => Number(a) - Number(b));

        tokenQueryOffset = -1;

        for (let i = recordedBlocks.length - 1; i >= 0; i--) {
            const record = chainHistory[contract][recordedBlocks[i]];

            if (tokenQueryOffset < 0 && record['tokenBalance'] !== undefined) {
                tokenQueryOffset = i - 1;
                lastRecodedBlock = Number(recordedBlocks[i]);
                break;
            }
        }

        tokenQueryOffset = Math.max(tokenQueryOffset, 0);

        console.log(`found existing token balance data for ${contract}: ${tokenQueryOffset}`);
    }

    while (lastRecodedBlock < limit) {
        const tokenHistory = await getContractTokenHistory(contract, tokenQueryOffset, querySize);
        if (Object.keys(tokenHistory).length === 0) { break; }

        Object.keys(tokenHistory).map(level => {
            if (chainHistory[contract][level] === undefined) {
                chainHistory[contract][level] = {}
            };

            chainHistory[contract][level].tokenBalance = tokenHistory[level];
            lastRecodedBlock = Math.max(lastRecodedBlock, Number(level));
        });

        tokenQueryOffset += querySize;
    }

    return chainHistory;
}

async function importContractTransactions(chainHistory: ChainHistory, contract: ContractInfo, limit: string | number): Promise<ChainHistory> {
    let queryStartBlock = contract.deploymentBlock;
    if (chainHistory[contract.address] === undefined) {
        chainHistory[contract.address] = {};
    } else {
        const recordedBlocks = Object.keys(chainHistory[contract.address]).sort((a, b) => Number(a) - Number(b));

        queryStartBlock = -1;

        for (let i = recordedBlocks.length - 1; i >= 0; i--) {
            const record = chainHistory[contract.address][recordedBlocks[i]];

            if (queryStartBlock < 0 && record['operations'] !== undefined && Object.keys(record['operations']).length > 0) {
                queryStartBlock = Number(recordedBlocks[i]);
                break;
            }
        }

        queryStartBlock = Math.max(queryStartBlock, Number(contract.deploymentBlock));

        console.log(`found existing transactions data for ${contract.address}: ${queryStartBlock}`);
    }

    while (queryStartBlock < limit) {
        const operationHistory = await getContractTransactions(contract.address, contract.entrypoints, Number(queryStartBlock), Number(queryStartBlock) + querySize);

        Object.keys(operationHistory).map(level => {
            if (chainHistory[contract.address][level] === undefined) {
                chainHistory[contract.address][level] = {}
            };

            const levelOperations = operationHistory[level];
            chainHistory[contract.address][level].operations = {};
            for (const operation of levelOperations) {
                chainHistory[contract.address][level].operations[operation.hash] = {
                    receiver: operation.operator,
                    input: operation.input,
                    amount: operation.amount
                }
            }
        });

        queryStartBlock = Math.min(Number(queryStartBlock) + querySize, Number(limit));
    }

    return chainHistory;
}

async function importSupplyHistory(chainHistory: ChainHistory, contract: string, limit: string | number): Promise<ChainHistory> {
    let supplyQueryOffset = 0;
    let lastRecodedBlock = 0;
    if (chainHistory[contract] === undefined) {
        chainHistory[contract] = {};
    } else {
        const recordedBlocks = Object.keys(chainHistory[contract]).sort((a, b) => Number(a) - Number(b));

        supplyQueryOffset = -1;

        for (let i = recordedBlocks.length - 1; i >= 0; i--) {
            const record = chainHistory[contract][recordedBlocks[i]];

            if (supplyQueryOffset < 0 && record['totalSupply'] !== undefined) {
                supplyQueryOffset = i - 1;
                lastRecodedBlock = Number(recordedBlocks[i]);
                break;
            }
        }

        supplyQueryOffset = Math.max(supplyQueryOffset, 0);

        console.log(`found existing supply data for ${contract}: ${supplyQueryOffset}`);
    }

    while (lastRecodedBlock < limit) {
        const supplyHistory = await getSupplyHistory(usdtzTokenAddress, supplyQueryOffset, querySize);
        if (Object.keys(supplyHistory).length === 0) { break; }

        Object.keys(supplyHistory).map(level => {
            if (chainHistory[contract][level] === undefined) {
                chainHistory[contract][level] = {}
            };

            chainHistory[contract][level].totalSupply = supplyHistory[level];
            lastRecodedBlock = Math.max(lastRecodedBlock, Number(level));
        });

        supplyQueryOffset += querySize;
    }

    return chainHistory;
}

async function importBlockTimestamp(chainHistory: ChainHistory, contract: string): Promise<ChainHistory> {
    const recordedBlocks = Object.keys(chainHistory[contract]).sort((a, b) => Number(a) - Number(b));

    for await (const level of recordedBlocks) {
        if (chainHistory[contract][level].timestamp !== undefined) { continue; }
        const url = `https://api.tzkt.io/v1/blocks/${level}/timestamp`;
        const result = await fetch(`${url}`, { method: 'GET', cache: 'no-cache' });
        const date = await result.json();
        chainHistory[contract][level].timestamp = date;
    }

    return chainHistory;
}

async function importBlockCoinPrice(chainHistory: ChainHistory, contract: string): Promise<ChainHistory> {
    const recordedBlocks = Object.keys(chainHistory[contract]).sort((a, b) => Number(a) - Number(b));

    for await (const level of recordedBlocks) {
        if (chainHistory[contract][level].price !== undefined) { continue; }
        const url = `https://api.tzkt.io/v1/blocks/${level}?quote=usd`;
        const result = await fetch(`${url}`, { method: 'GET', cache: 'no-cache' });
        const data = await result.json();
        chainHistory[contract][level].price = data['quote']['usd'];
    }

    return chainHistory;
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
    const rawRevenue = {};
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
                        previousCoinBalance = chainHistory[contract][keys[levelIndex]].coinBalance;
                        break;
                    }
                    --levelIndex;
                }

                if (previousCoinBalance === undefined) {
                    console.log(`missing previousCoinBalance at ${level}`);
                    continue;
                }
            } else if (previousCoinBalance !== undefined && previousTokenBalance === undefined) {
                let levelIndex = keys.indexOf(`${previousLevel}`);
                const limit = Math.max(levelIndex - 10, 0);
                while (levelIndex > limit) {
                    if (previousCoinBalance === chainHistory[contract][keys[levelIndex]].coinBalance && chainHistory[contract][keys[levelIndex]].tokenBalance !== undefined) {
                        previousTokenBalance = chainHistory[contract][keys[levelIndex]].tokenBalance;
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

            const coinRevenue = Number(currentCoinBalance) - Number(previousCoinBalance) - expectedCoinDiff;
            const tokenRevenue = Number(currentTokenBalance) - Number(previousTokenBalance) - expectedTokenDiff;

            // console.log(`${level} from ${previousLevel}`);
            // console.log(`starting ${previousCoinBalance}c, ${previousTokenBalance}t`);
            // console.log(`ending   ${currentCoinBalance}c, ${currentTokenBalance}t`);
            // console.log(`diff ${Number(currentCoinBalance) - Number(previousCoinBalance)}c, ${Number(currentTokenBalance) - Number(previousTokenBalance)}t`);
            // console.log(`exp  ${expectedCoinDiff}c, ${expectedTokenDiff}t`)
            // console.log(`revenue ${coinRevenue}c, ${tokenRevenue}t`)

            previousLevel = Number(level);
            rawRevenue[level] = {
                timestamp: chainHistory[contract][level].timestamp,
                coinRevenue: coinRevenue,
                tokenRevenue: tokenRevenue,
                coinBalance: currentCoinBalance,
                tokenBalance: currentTokenBalance,
                coinPrice: chainHistory[contract][level].price
            }
        } catch (err) {
            console.log(`exportYieldSeries failed at ${level}`);
            throw err;
        }
    }

    console.log('revenue', rawRevenue)

    const dailyRevenue = {}
    for (const level of Object.keys(rawRevenue)) {
        const date = new Date(rawRevenue[level].timestamp);
        const dateKey = date.toLocaleDateString();

        if (dailyRevenue[dateKey] === undefined) {
            dailyRevenue[dateKey] = {
                level,
                coinRevenue: rawRevenue[level].coinRevenue,
                tokenRevenue: rawRevenue[level].tokenRevenue,
                coinBalance: rawRevenue[level].coinBalance,
                tokenBalance: rawRevenue[level].tokenBalance,
                coinPrice: rawRevenue[level].coinPrice
            }
        } else {
            if (dailyRevenue[dateKey].level < level) {
                dailyRevenue[dateKey].level = level;
                dailyRevenue[dateKey].coinBalance = rawRevenue[level].coinBalance;
                dailyRevenue[dateKey].tokenBalance = rawRevenue[level].tokenBalance;
                dailyRevenue[dateKey].coinPrice = rawRevenue[level].coinPrice;
            }
            dailyRevenue[dateKey].coinRevenue += rawRevenue[level].coinRevenue;
            dailyRevenue[dateKey].tokenRevenue += rawRevenue[level].tokenRevenue;
        }
    }
    console.log('revenue', dailyRevenue)

    const dollarizedRevenue = {};
    for (const date of Object.keys(dailyRevenue)) {
        const tvl = (Number(dailyRevenue[date].coinBalance) * dailyRevenue[date].coinPrice + Number(dailyRevenue[date].tokenBalance)) / 1_000_000;
        const revenue = (Number(dailyRevenue[date].coinRevenue) * dailyRevenue[date].coinPrice + Number(dailyRevenue[date].tokenRevenue)) / 1_000_000;
        dollarizedRevenue[date] = {
            tvl,
            revenue,
            rr: revenue / tvl,
            apr: revenue * 365 / tvl
        }
    }
    console.log('revenue', dollarizedRevenue)
}

async function run() {
    const contracts: ContractInfo[] = [
        {
            name: 'QuipuSwap USDtz',
            address: 'KT1WxgZ1ZSfMgmsSDDcUn8Xn577HwnQ7e1Lb',
            deploymentBlock: 1434933,
            entrypoints: ['tezToTokenPayment', 'tokenToTezPayment', 'investLiquidity', 'divestLiquidity']

            // JSONpaths
            // history file path
        }
    ];

    // const head = await getLastBlockLevel();
    const head = 1434933 + 6000;

    let chainHistory: ChainHistory = {};

    try {
        chainHistory = JSON.parse(fs.readFileSync('./chainHistory.json').toString());
    } catch { }

    for (const contract of contracts) {
        // chainHistory = await importCoinBalanceHistory(chainHistory, contract.address, head);
        // chainHistory = await importTokenBalanceHistory(chainHistory, contract.address, head);
        // chainHistory = await importContractTransactions(chainHistory, contract, head);
        // chainHistory = await importSupplyHistory(chainHistory, contract.address, head);
        // chainHistory = await importBlockTimestamp(chainHistory, contract.address);
        // chainHistory = await importBlockCoinPrice(chainHistory, contract.address);
    }

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
