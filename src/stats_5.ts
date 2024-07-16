import bigInt from 'big-integer';
import fs from 'fs';
import { JSONPath } from 'jsonpath-plus';
import * as fetch from 'node-fetch';

import { BalanceMap, ChainHistory, ContractInfo, OperationMap } from './types';

const usdtzTokenAddress = 'KT1LN4LPSqTMS7Sd2CJw4bbDGRkMv2t68Fy9';
const usdtzTokenLedgerMapId = 36;
const querySize = 5000;

function getCashToTokenExchangeRate(cashAmount: string, tokenBalance: string, cashBalance: string, rate: number = 1000) {
    try {
        const n = bigInt(cashAmount)
            .multiply(bigInt(tokenBalance))
            .multiply(bigInt(rate));
        const d = bigInt(cashBalance)
            .multiply(bigInt(1000))
            .add(bigInt(cashAmount)
                .multiply(bigInt(rate)));

        const tokenAmount = n.divide(d);
        const dm = tokenAmount.divmod(bigInt(cashAmount));
        const f = dm.remainder.multiply(bigInt(1_000_000)).divide(bigInt(cashAmount));

        return { tokenAmount: tokenAmount.toString(), rate: parseFloat(`${dm.quotient.toJSNumber()}.${f.toJSNumber()}`) };
    } catch (err) {
        console.error(`getCashToTokenExchangeRate failed with "${err}" for ${cashAmount}, ${tokenBalance}, ${cashBalance}, ${rate}`)
        throw err;
    }
}

function getTokenToCashExchangeRate(tokenAmount: string, tokenBalance: string, cashBalance: string, rate: number = 1000) {
    try{const n = bigInt(tokenAmount)
        .multiply(bigInt(cashBalance))
        .multiply(bigInt(rate));
    const d = bigInt(tokenBalance)
        .multiply(bigInt(1000))
        .add(bigInt(tokenAmount)
            .multiply(bigInt(rate)));

    const cashAmount = n.divide(d);
    const dm = cashAmount.divmod(bigInt(tokenAmount));
    const f = dm.remainder.multiply(bigInt(1_000_000)).divide(bigInt(tokenAmount));

    return { cashAmount: cashAmount.toString(), rate: parseFloat(`${dm.quotient.toJSNumber()}.${f.toJSNumber()}`) };}
    catch (err) {
        console.error(`getTokenToCashExchangeRate failed with "${err}" for ${tokenAmount}, ${tokenBalance}, ${cashBalance}, ${rate}`)
        throw err;
    }
}

async function getLastBlockLevel(): Promise<number> {
    const url = 'https://api.tzkt.io/v1/blocks/count';
    const result = await fetch(url, { method: 'GET', cache: 'no-cache' });
    const data = await result.text();

    return Number(data);
}

async function getContractTransactions(contract: string, entrypoints: string[], startBlock: number, endBlock: number) {
    const fields = ['level', 'hash', 'amount', 'parameter', 'sender', 'timestamp', 'quote']; // 'initiator'
    const url = 'https://api.tzkt.io/v1/operations/transactions';
    const params = `target=${contract}&level.lt=${endBlock}&level.ge=${startBlock}&entrypoint.in=${entrypoints.join(',')}&sort=level&select=${fields.join(',')}&status=applied&quote=Usd&limit=${querySize}`;
    const result = await fetch(`${url}?${params}`, { method: 'GET', cache: 'no-cache' });
    const data = await result.json();
    // console.log('getContractTransactions', `${url}?${params}`, JSON.stringify(data));

    const operationHistory: OperationMap = {};
    const timestampHistory = {};
    const quoteHistory = {};
    for (const row of data) {
        if (operationHistory[row['level']] === undefined) { operationHistory[row['level']] = []; }

        timestampHistory[row['level']] = row['timestamp'];
        quoteHistory[row['level']] = row['quote']['usd'];

        if (row['parameter']['entrypoint'] === 'investLiquidity') {
            operationHistory[row['level']].push({
                hash: row['hash'],
                operator: row['sender']['address'],
                coinAmount: row['amount'],
                tokenAmount: row['parameter']['value']
            });
        } else if (row['parameter']['entrypoint'] === 'divestLiquidity') {
            operationHistory[row['level']].push({
                hash: row['hash'],
                operator: row['sender']['address'],
                coinAmount: `-${row['parameter']['value']['min_tez']}`,
                tokenAmount: `-${row['parameter']['value']['min_tokens']}`
            });
        } else if (row['amount'] === 0) { // tezToTokenPayment
            operationHistory[row['level']].push({
                hash: row['hash'],
                operator: row['sender']['address'], // TODO: may need row['initiator']['address'] or a call param value
                input: 'token',
                amount: JSONPath({ path: '$.value.amount', json: row['parameter'] })[0]
            });
        } else { // tokenToTezPayment
            operationHistory[row['level']].push({
                hash: row['hash'],
                operator: row['sender']['address'], // TODO: may need row['initiator']['address'] or a call param value
                input: 'coin',
                amount: row['amount']
            });
        }
    }

    return {
        operations: operationHistory,
        timestamps: timestampHistory,
        quotes: quoteHistory
    };
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

async function getContractInternalBalanceHistory(contract: string, blah: number, blahblah: number): Promise<BalanceMap> {
    let offset = 0; // 0 is the most recent record
    const limit = 1434933;
    let lastRecodedBlock = Number.MAX_VALUE;
    const url = `https://api.tzkt.io/v1/contracts/${contract}/storage/history`;

    const balanceHistory: BalanceMap = {};
    while (lastRecodedBlock > limit) { // data comes in descending
        let params = `lastId=${offset}&limit=1000`; // max limit is 1000
        const result = await fetch(`${url}?${params}`, { method: 'GET', cache: 'no-cache' });
        const data = await result.json();
        // console.log('getSupplyHistory', `${url}?${params}`, JSON.stringify(data));

        for (const row of data) {
            if (Number(row['level']) < lastRecodedBlock) {
                lastRecodedBlock = Number(row['level']);
                offset = row['id'];
            }

            balanceHistory[row['level']] = JSONPath({ path: '$.storage.tez_pool', json: row['value'] })[0];
        }
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
    const params = `lastId=${offset}&limit=${Math.min(1000, length)}`;
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
    console.log(`${(new Date()).toLocaleTimeString()} importCoinBalanceHistory for ${contract} through ${limit}`);
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

        console.log(`${(new Date()).toLocaleTimeString()} importCoinBalanceHistory, existing through ${lastRecodedBlock}, ${coinQueryOffset}`);
    }

    console.log(`${(new Date()).toLocaleTimeString()} importCoinBalanceHistory, fetching`);
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

    console.log(`${(new Date()).toLocaleTimeString()} importCoinBalanceHistory, fetched til ${lastRecodedBlock}`);

    return chainHistory;
}

async function importInternalCoinBalanceHistory(chainHistory: ChainHistory, contract: string, limit: string | number): Promise<ChainHistory> {
    console.log(`${(new Date()).toLocaleTimeString()} importInternalCoinBalanceHistory for ${contract} through ${limit}`);
    let coinQueryOffset = 0;
    let lastRecodedBlock = 0;
    if (chainHistory[contract] === undefined) {
        chainHistory[contract] = {};
    } else {
        const recordedBlocks = Object.keys(chainHistory[contract]).sort((a, b) => Number(a) - Number(b));

        coinQueryOffset = -1;

        for (let i = recordedBlocks.length - 1; i >= 0; i--) {
            const record = chainHistory[contract][recordedBlocks[i]];

            if (coinQueryOffset < 0 && record['internalCoinBalance'] !== undefined) {
                coinQueryOffset = i - 1;
                lastRecodedBlock = Number(recordedBlocks[i]);
                break;
            }
        }

        coinQueryOffset = Math.max(coinQueryOffset, 0);

        console.log(`${(new Date()).toLocaleTimeString()} importInternalCoinBalanceHistory, existing through ${lastRecodedBlock}, ${coinQueryOffset}`);
    }

    console.log(`${(new Date()).toLocaleTimeString()} importInternalCoinBalanceHistory, fetching from ${coinQueryOffset}`);
    while (lastRecodedBlock + 1000 < limit) { // TODO: 1000 is needs to be better
        const coinHistory = await getContractInternalBalanceHistory(contract, coinQueryOffset, querySize);
        if (Object.keys(coinHistory).length === 0) { break; }

        Object.keys(coinHistory).map(level => {
            if (chainHistory[contract][level] === undefined) {
                chainHistory[contract][level] = {};
            };

            chainHistory[contract][level].internalCoinBalance = coinHistory[level];
            lastRecodedBlock = Math.max(lastRecodedBlock, Number(level));
        });

        coinQueryOffset += querySize;
        console.log(`importInternalCoinBalanceHistory, ${lastRecodedBlock < limit}, ${lastRecodedBlock}, ${limit}`)
    }

    console.log(`${(new Date()).toLocaleTimeString()} importInternalCoinBalanceHistory, fetched til ${lastRecodedBlock}`);

    return chainHistory;
}

async function importTokenBalanceHistory(chainHistory: ChainHistory, contract: string, limit: string | number): Promise<ChainHistory> {
    console.log(`${(new Date()).toLocaleTimeString()} importTokenBalanceHistory for ${contract} through ${limit}`);

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

        console.log(`${(new Date()).toLocaleTimeString()} importTokenBalanceHistory, existing through ${lastRecodedBlock}, ${tokenQueryOffset}`);
    }

    console.log(`${(new Date()).toLocaleTimeString()} importTokenBalanceHistory, fetching`);
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

    console.log(`${(new Date()).toLocaleTimeString()} importTokenBalanceHistory, fetched til ${lastRecodedBlock}`);

    return chainHistory;
}

async function importContractTransactions(chainHistory: ChainHistory, contract: ContractInfo, limit: string | number): Promise<ChainHistory> {
    console.log(`${(new Date()).toLocaleTimeString()} importContractTransactions for ${contract.address} through ${limit}`);
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

        console.log(`${(new Date()).toLocaleTimeString()} importContractTransactions, existing through ${queryStartBlock}`);
    }
    queryStartBlock = contract.deploymentBlock;

    console.log(`${(new Date()).toLocaleTimeString()} importContractTransactions, fetching`);
    while (queryStartBlock < limit) {
        console.log(`${(new Date()).toLocaleTimeString()} importContractTransactions, querying ${Number(queryStartBlock)} ... ${Number(queryStartBlock) + querySize}`);

        const result = await getContractTransactions(contract.address, contract.entrypoints, Number(queryStartBlock), Number(queryStartBlock) + querySize);

        const operationHistory = result.operations;
        let lastLevel = 0;
        Object.keys(operationHistory).map(level => {
            if (chainHistory[contract.address][level] === undefined) {
                chainHistory[contract.address][level] = {}
            };

            const levelOperations = operationHistory[level];
            chainHistory[contract.address][level].operations = {};
            for (const operation of levelOperations) {
                if (operation['coinAmount'] !== undefined) {
                    chainHistory[contract.address][level].operations[operation.hash] = {
                        receiver: operation.operator,
                        coinAmount: operation.coinAmount,
                        tokenAmount: operation.tokenAmount
                    };
                } else {
                    chainHistory[contract.address][level].operations[operation.hash] = {
                        receiver: operation.operator,
                        input: operation.input,
                        amount: operation.amount
                    };
                }
            }

            chainHistory[contract.address][level].timestamp = result.timestamps[level];
            chainHistory[contract.address][level].price = result.quotes[level];
            lastLevel = Math.max(lastLevel, Number(level));
            
        });
        console.log('last', lastLevel)
        queryStartBlock = Math.min(Number(queryStartBlock) + querySize, Number(limit));
    }

    console.log(`${(new Date()).toLocaleTimeString()} importContractTransactions, fetched til ${queryStartBlock}`);

    return chainHistory;
}

async function importSupplyHistory(chainHistory: ChainHistory, contract: string, limit: string | number): Promise<ChainHistory> {
    console.log(`${(new Date()).toLocaleTimeString()} importSupplyHistory for ${contract} through ${limit}`);
    let supplyQueryOffset = 0;
    let lastRecodedBlock = 0;
    if (chainHistory[contract] === undefined) {
        chainHistory[contract] = {};
    } else {
        const recordedBlocks = Object.keys(chainHistory[contract]).sort((a, b) => Number(a) - Number(b));

        supplyQueryOffset = 0;

        for (let i = recordedBlocks.length - 1; i >= 0; i--) {
            const record = chainHistory[contract][recordedBlocks[i]];

            if (record['totalSupply'] !== undefined) {
                supplyQueryOffset = i - 1;
                lastRecodedBlock = Number(recordedBlocks[i]);
                break;
            }
        }

        console.log(`${(new Date()).toLocaleTimeString()} importContractTransactions, existing through ${lastRecodedBlock}, ${supplyQueryOffset}`);
    }

    console.log(`${(new Date()).toLocaleTimeString()} importSupplyHistory, fetching`);
    let i = 0;
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
        if (++i % 10 === 0) { console.log(`${(new Date()).toLocaleTimeString()} importSupplyHistory at ${lastRecodedBlock}`); }
    }

    console.log(`${(new Date()).toLocaleTimeString()} importSupplyHistory, fetched til ${lastRecodedBlock}`);

    return chainHistory;
}

async function importBlockCoinPrice(chainHistory: ChainHistory, contract: string): Promise<ChainHistory> {
    console.log(`${(new Date()).toLocaleTimeString()} importBlockCoinPrice for ${contract}`);
    const recordedBlocks = Object.keys(chainHistory[contract]).sort((a, b) => Number(a) - Number(b));

    let i = 0;
    for await (const level of recordedBlocks) {
        if (chainHistory[contract][level].price !== undefined) { continue; }

        const url = `https://api.tzkt.io/v1/blocks/${level}?quote=usd`;
        const result = await fetch(`${url}`, { method: 'GET', cache: 'no-cache' });
        const data = await result.json();
        chainHistory[contract][level].price = data['quote']['usd'];
        chainHistory[contract][level].timestamp = data['timestamp'];
        if (++i % 100 === 0) { console.log(`${(new Date()).toLocaleTimeString()} importBlockCoinPrice at ${level}`); }
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

            let startingCoinBalance = Number(chainHistory[contract][previousLevel].coinBalance);
            let startingInternalCoinBalance = Number(chainHistory[contract][previousLevel].internalCoinBalance);
            let startingTokenBalance = Number(chainHistory[contract][previousLevel].tokenBalance);

            if ((startingCoinBalance === undefined || isNaN(startingCoinBalance)) && startingTokenBalance !== undefined) {
                // console.log(`missing startingCoinBalance at ${level}/${previousLevel}`);
                let levelIndex = keys.indexOf(`${previousLevel}`);
                const limit = Math.max(levelIndex - 10, 0);
                while (levelIndex > limit) {
                    if (startingTokenBalance === chainHistory[contract][keys[levelIndex]].tokenBalance && chainHistory[contract][keys[levelIndex]].coinBalance !== undefined) {
                        startingCoinBalance = Number(chainHistory[contract][keys[levelIndex]].coinBalance);
                        break;
                    }
                    --levelIndex;
                }

                if (startingCoinBalance === undefined) {
                    console.log(`missing startingCoinBalance at ${level}`);
                    continue;
                }
            } else if (startingCoinBalance !== undefined && (startingTokenBalance === undefined || isNaN(startingTokenBalance))) {
                // console.log(`missing startingTokenBalance at ${level}/${previousLevel}`);
                let levelIndex = keys.indexOf(`${previousLevel}`);
                const limit = Math.max(levelIndex - 30, 0);
                while (levelIndex > limit) {
                    // console.log(`checking index ${levelIndex}, ${keys[levelIndex]}`)
                    // if (startingCoinBalance === chainHistory[contract][keys[levelIndex]].coinBalance && chainHistory[contract][keys[levelIndex]].tokenBalance !== undefined) {
                    if (chainHistory[contract][keys[levelIndex]].tokenBalance !== undefined) {
                        startingTokenBalance = Number(chainHistory[contract][keys[levelIndex]].tokenBalance);
                        // console.log('found')
                        break;
                    }
                    --levelIndex;
                }

                if (startingTokenBalance === undefined) {
                    console.log(`missing startingTokenBalance at ${level}`);
                    continue;
                }
            }

            if ((startingInternalCoinBalance === undefined || isNaN(startingInternalCoinBalance)) && startingTokenBalance !== undefined) {
                console.log(`missing startingInternalCoinBalance at ${level}/${previousLevel}`);
                let levelIndex = keys.indexOf(`${previousLevel}`);
                const limit = Math.max(levelIndex - 30, 0);
                while (levelIndex > limit) {
                    // console.log(`checking index ${levelIndex}, ${keys[levelIndex]}`)
                    // if (startingTokenBalance === chainHistory[contract][keys[levelIndex]].tokenBalance && chainHistory[contract][keys[levelIndex]].internalCoinBalance !== undefined) {
                    if (chainHistory[contract][keys[levelIndex]].internalCoinBalance !== undefined) {
                        startingInternalCoinBalance = Number(chainHistory[contract][keys[levelIndex]].internalCoinBalance);
                        // console.log('found')
                        break;
                    }
                    --levelIndex;
                }

                if (startingInternalCoinBalance === undefined) {
                    console.log(`missing startingInternalCoinBalance at ${level} through ${keys[levelIndex]}`);
                    continue;
                }
            }

            startingInternalCoinBalance = startingInternalCoinBalance || startingCoinBalance;

            // apply LP changes
            for (const hash of Object.keys(chainHistory[contract][level]['operations'])) {
                const operation = chainHistory[contract][level]['operations'][hash];

                if (operation['coinAmount'] !== undefined) {
                    console.log('updating liquidity')
                    console.log(`${Number(startingTokenBalance)} + ${Number(operation['tokenAmount'])}`)
                    console.log(`${Number(startingCoinBalance)} + ${Number(operation['coinAmount'])}`)
                    startingTokenBalance += Number(operation['tokenAmount']);
                    startingCoinBalance += Number(operation['coinAmount']);
                    startingInternalCoinBalance += Number(operation['coinAmount'])
                    console.log('updated', startingTokenBalance, startingCoinBalance)
                }
            }

            let anchorCoinBalance = startingCoinBalance;
            let anchorInternalCoinBalance = startingInternalCoinBalance || startingCoinBalance;
            if (Number(level) < 1435534) { // 1484188
                anchorInternalCoinBalance = startingCoinBalance;
            }
            let anchorTokenBalance = startingTokenBalance;

            let endingCoinBalance = chainHistory[contract][level].coinBalance;
            let endingTokenBalance = chainHistory[contract][level].tokenBalance;
            let expectedCoinDiff = 0;
            let expectedTokenDiff = 0;
            // apply swaps
            let swapsPresent = false;
            let volume = 0;
            for (const hash of Object.keys(chainHistory[contract][level]['operations'])) {
                const operation = chainHistory[contract][level]['operations'][hash];

                if (operation.input === 'token') {
                    const expectedResult = getTokenToCashExchangeRate(operation.amount.toString(), startingTokenBalance.toString(), anchorInternalCoinBalance.toString());
                    expectedCoinDiff -= Number(expectedResult.cashAmount);
                    expectedTokenDiff += Number(operation.amount);

                    const reducedResult = getTokenToCashExchangeRate(operation.amount.toString(), startingTokenBalance.toString(), anchorInternalCoinBalance.toString(), 997);
                    anchorInternalCoinBalance -= Number(reducedResult.cashAmount);
                    startingTokenBalance += Number(operation.amount);

                    console.log(`full output coin: ${expectedResult.cashAmount}, partial: ${reducedResult.cashAmount}`)
                    console.log(`input token ${Number(operation.amount)}`)
                    swapsPresent = true;
                    volume += Number(expectedResult.cashAmount);
                } else if (operation.input === 'coin') {
                    const expectedResult = getCashToTokenExchangeRate(operation.amount.toString(), startingTokenBalance.toString(), anchorInternalCoinBalance.toString());
                    expectedTokenDiff -= Number(expectedResult.tokenAmount);
                    expectedCoinDiff += Number(operation.amount);

                    const reducedResult = getCashToTokenExchangeRate(operation.amount.toString(), startingTokenBalance.toString(), anchorInternalCoinBalance.toString(), 997);
                    startingTokenBalance -= Number(reducedResult.tokenAmount);
                    anchorInternalCoinBalance += Number(operation.amount);
                    console.log(`full output token: ${expectedResult.tokenAmount}, partial: ${reducedResult.tokenAmount}`)
                    console.log(`input coin ${Number(operation.amount)}`)
                    swapsPresent = true;
                    volume += Number(operation.amount);
                }
            }

            let coinRevenue = swapsPresent ? Number(endingCoinBalance) - anchorCoinBalance - expectedCoinDiff : 0;
            let tokenRevenue = swapsPresent ? Number(endingTokenBalance) - anchorTokenBalance - expectedTokenDiff : 0;

            if (Math.abs(coinRevenue) < 50) { // rounding errors
                coinRevenue = 0;
            }

            if (Math.abs(tokenRevenue) < 50) { // rounding errors
                tokenRevenue = 0;
            }

            console.log(`${level} from ${previousLevel}`);
            console.log(`starting ${anchorCoinBalance}c, ${anchorTokenBalance}t`);
            console.log(`intra    ${startingCoinBalance}c, ${startingTokenBalance}t`);
            console.log(`ending   ${endingCoinBalance}c, ${endingTokenBalance}t`);
            console.log(`diff ${Number(endingCoinBalance) - Number(anchorCoinBalance)}c, ${Number(endingTokenBalance) - Number(anchorTokenBalance)}t`);
            console.log(`exp  ${expectedCoinDiff}c, ${expectedTokenDiff}t`)
            console.log(`revenue ${coinRevenue}c, ${tokenRevenue}t`)

            previousLevel = Number(level);
            rawRevenue[level] = {
                timestamp: chainHistory[contract][level].timestamp,
                coinRevenue: coinRevenue,
                tokenRevenue: tokenRevenue,
                coinBalance: endingCoinBalance,
                tokenBalance: endingTokenBalance,
                coinPrice: chainHistory[contract][level].price,
                volume
            }
        } catch (err) {
            console.log(`exportYieldSeries failed at ${level}`);
            throw err;
        }
    }

    console.log('raw revenue', rawRevenue)

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
                coinPrice: rawRevenue[level].coinPrice,
                volume: rawRevenue[level].volume
            }
        } else {
            if (dailyRevenue[dateKey].level < level) {
                dailyRevenue[dateKey].level = level;
                dailyRevenue[dateKey].coinBalance = rawRevenue[level].coinBalance;
                dailyRevenue[dateKey].tokenBalance = rawRevenue[level].tokenBalance;
                dailyRevenue[dateKey].coinPrice = rawRevenue[level].coinPrice;
            }
            dailyRevenue[dateKey].volume += rawRevenue[level].volume;
            dailyRevenue[dateKey].coinRevenue += rawRevenue[level].coinRevenue;
            dailyRevenue[dateKey].tokenRevenue += rawRevenue[level].tokenRevenue;
        }
    }
    // console.log('revenue', dailyRevenue)

    const dollarizedRevenue = {};
    for (const date of Object.keys(dailyRevenue)) {
        const tvl = (Number(dailyRevenue[date].coinBalance) * dailyRevenue[date].coinPrice + Number(dailyRevenue[date].tokenBalance)) / 1_000_000;
        const revenue = (Number(dailyRevenue[date].coinRevenue) * dailyRevenue[date].coinPrice + Number(dailyRevenue[date].tokenRevenue)) / 1_000_000;
        dollarizedRevenue[date] = {
            tvl,
            revenue,
            volume: dailyRevenue[date].volume / 1_000_000 * dailyRevenue[date].coinPrice,
            rr: revenue / tvl,
            apr: revenue * 365 / tvl
        }
    }
    console.log('dollarized revenue', dollarizedRevenue)

    fs.writeFileSync('./dollarizedRevenue.json', JSON.stringify(dollarizedRevenue, undefined, 4));

    let csvDollarizedRevenue = 'timestamp,volume,tvl,revenue,rr,apr\n';
    for (const date of Object.keys(dollarizedRevenue)) {
        const row = dollarizedRevenue[date];
        csvDollarizedRevenue += `${date},${row['volume']},${row['tvl']},${row['revenue']},${row['rr']},${row['apr']}\n`;
    }
    fs.writeFileSync('./dollarizedRevenue.csv', csvDollarizedRevenue);
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

    // const head = 1434933 + 1_000;
    // const head = 1434933 + 500_000;
    const head = await getLastBlockLevel();
    // const head = 3183435 + 1_000;
    // const head = 1548707;
    // const head = 1764933;

    let chainHistory: ChainHistory = {};

    try {
        chainHistory = JSON.parse(fs.readFileSync('./chainHistory.json').toString());
    } catch (err) {
        console.log(`failed to parse chainHistory at ./chainHistory.json due to ${err}`)
    }

    for (const contract of contracts) {
        // chainHistory = await importInternalCoinBalanceHistory(chainHistory, contract.address, head);
        // fs.writeFileSync('./chainHistory.json', JSON.stringify(chainHistory, undefined, 4));
        // chainHistory = await importCoinBalanceHistory(chainHistory, contract.address, head);
        // fs.writeFileSync('./chainHistory.json', JSON.stringify(chainHistory, undefined, 4));
        // chainHistory = await importTokenBalanceHistory(chainHistory, contract.address, head);
        // fs.writeFileSync('./chainHistory.json', JSON.stringify(chainHistory, undefined, 4));
        // chainHistory = await importContractTransactions(chainHistory, contract, head);
        // fs.writeFileSync('./chainHistory.json', JSON.stringify(chainHistory, undefined, 4));
    }

    // fs.writeFileSync('./chainHistory.json', JSON.stringify(chainHistory, undefined, 4));

    // exportSupplySeries(chainHistory, 'KT1WxgZ1ZSfMgmsSDDcUn8Xn577HwnQ7e1Lb');
    exportYieldSeries(chainHistory, 'KT1WxgZ1ZSfMgmsSDDcUn8Xn577HwnQ7e1Lb');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});


// https://api.tzkt.io/#operation/BigMaps_GetBigMapUpdates
