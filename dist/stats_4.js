"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const big_integer_1 = __importDefault(require("big-integer"));
const fs_1 = __importDefault(require("fs"));
const jsonpath_plus_1 = require("jsonpath-plus");
const fetch = __importStar(require("node-fetch"));
const usdtzTokenAddress = 'KT1LN4LPSqTMS7Sd2CJw4bbDGRkMv2t68Fy9';
const usdtzTokenLedgerMapId = 36;
const querySize = 5000;
function getCashToTokenExchangeRate(cashAmount, tokenBalance, cashBalance, rate = 1000) {
    const n = (0, big_integer_1.default)(cashAmount)
        .multiply((0, big_integer_1.default)(tokenBalance))
        .multiply((0, big_integer_1.default)(rate));
    const d = (0, big_integer_1.default)(cashBalance)
        .multiply((0, big_integer_1.default)(1000))
        .add((0, big_integer_1.default)(cashAmount)
        .multiply((0, big_integer_1.default)(rate)));
    const tokenAmount = n.divide(d);
    const dm = tokenAmount.divmod((0, big_integer_1.default)(cashAmount));
    const f = dm.remainder.multiply((0, big_integer_1.default)(1000000)).divide((0, big_integer_1.default)(cashAmount));
    return { tokenAmount: tokenAmount.toString(), rate: parseFloat(`${dm.quotient.toJSNumber()}.${f.toJSNumber()}`) };
}
function getTokenToCashExchangeRate(tokenAmount, tokenBalance, cashBalance, rate = 1000) {
    const n = (0, big_integer_1.default)(tokenAmount)
        .multiply((0, big_integer_1.default)(cashBalance))
        .multiply((0, big_integer_1.default)(rate));
    const d = (0, big_integer_1.default)(tokenBalance)
        .multiply((0, big_integer_1.default)(1000))
        .add((0, big_integer_1.default)(tokenAmount)
        .multiply((0, big_integer_1.default)(rate)));
    const cashAmount = n.divide(d);
    const dm = cashAmount.divmod((0, big_integer_1.default)(tokenAmount));
    const f = dm.remainder.multiply((0, big_integer_1.default)(1000000)).divide((0, big_integer_1.default)(tokenAmount));
    return { cashAmount: cashAmount.toString(), rate: parseFloat(`${dm.quotient.toJSNumber()}.${f.toJSNumber()}`) };
}
async function getLastBlockLevel() {
    const url = 'https://api.tzkt.io/v1/blocks/count';
    const result = await fetch(url, { method: 'GET', cache: 'no-cache' });
    const data = await result.text();
    return Number(data);
}
async function getContractTransactions(contract, entrypoints, startBlock, endBlock) {
    const fields = ['level', 'hash', 'amount', 'parameter', 'sender', 'timestamp', 'quote']; // 'initiator'
    const url = 'https://api.tzkt.io/v1/operations/transactions';
    const params = `target=${contract}&level.lt=${endBlock}&level.ge=${startBlock}&entrypoint.in=${entrypoints.join(',')}&sort=level&select=${fields.join(',')}&status=applied&quote=Usd`;
    const result = await fetch(`${url}?${params}`, { method: 'GET', cache: 'no-cache' });
    const data = await result.json();
    // console.log('getContractTransactions', `${url}?${params}`, JSON.stringify(data));
    const operationHistory = {};
    const timestampHistory = {};
    const quoteHistory = {};
    for (const row of data) {
        if (operationHistory[row['level']] === undefined) {
            operationHistory[row['level']] = [];
        }
        timestampHistory[row['level']] = row['timestamp'];
        quoteHistory[row['level']] = row['quote']['usd'];
        if (row['parameter']['entrypoint'] === 'investLiquidity') {
            operationHistory[row['level']].push({
                hash: row['hash'],
                operator: row['sender']['address'],
                coinAmount: row['amount'],
                tokenAmount: row['parameter']['value']
            });
        }
        else if (row['parameter']['entrypoint'] === 'divestLiquidity') {
            operationHistory[row['level']].push({
                hash: row['hash'],
                operator: row['sender']['address'],
                coinAmount: `-${row['parameter']['value']['min_tez']}`,
                tokenAmount: `-${row['parameter']['value']['min_tokens']}`
            });
        }
        else if (row['amount'] === 0) { // tezToTokenPayment
            operationHistory[row['level']].push({
                hash: row['hash'],
                operator: row['sender']['address'],
                input: 'token',
                amount: (0, jsonpath_plus_1.JSONPath)({ path: '$.value.amount', json: row['parameter'] })[0]
            });
        }
        else { // tokenToTezPayment
            operationHistory[row['level']].push({
                hash: row['hash'],
                operator: row['sender']['address'],
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
async function getContractBalanceHistory(contract, offset, length) {
    const url = `https://api.tzkt.io/v1/accounts/${contract}/balance_history`;
    const params = `step=1&limit=${length}&offset=${offset}`;
    const result = await fetch(`${url}?${params}`, { method: 'GET', cache: 'no-cache' });
    const data = await result.json();
    // console.log('getContractBalanceHistory', `${url}?${params}`, JSON.stringify(data));
    let balanceHistory = {};
    for (const row of data) {
        balanceHistory[row['level']] = row['balance'];
    }
    return balanceHistory;
}
async function getContractStorageHistory(contract, offset, length) {
    const url = `https://api.tzkt.io/v1/contracts/${contract}/storage/history`;
    const params = `lastId=${offset}&limit=${Math.min(1000, length)}`;
    const result = await fetch(`${url}?${params}`, { method: 'GET', cache: 'no-cache' });
    const data = await result.json();
    // console.log('getSupplyHistory', `${url}?${params}`, JSON.stringify(data));
    let balanceHistory = {};
    for (const row of data) {
        balanceHistory[row['level']] = (0, jsonpath_plus_1.JSONPath)({ path: '$.storage.tez_pool', json: row['value'] })[0];
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
async function getContractTokenHistory(contract, startBlock, length) {
    const url = `https://api.tzkt.io/v1/bigmaps/${usdtzTokenLedgerMapId}/keys/${contract}/updates`;
    const params = `offset=${startBlock}&limit=${length}`;
    const result = await fetch(`${url}?${params}`, { method: 'GET', cache: 'no-cache' });
    const data = await result.json();
    // console.log('getContractTokenHistory', `${url}?${params}`, JSON.stringify(data));
    let balanceHistory = {};
    for (const row of data) {
        if (row['action'] !== 'update_key') {
            continue;
        }
        balanceHistory[row['level']] = row['value']['balance'];
    }
    return balanceHistory;
}
async function getSupplyHistory(contract, offset, length) {
    const url = `https://api.tzkt.io/v1/contracts/${contract}/storage/history`;
    const params = `lastId=${offset}&limit=${Math.min(1000, length)}`;
    const result = await fetch(`${url}?${params}`, { method: 'GET', cache: 'no-cache' });
    const data = await result.json();
    // console.log('getSupplyHistory', `${url}?${params}`, JSON.stringify(data));
    let balanceHistory = {};
    for (const row of data) {
        balanceHistory[row['level']] = (0, jsonpath_plus_1.JSONPath)({ path: '$.totalSupply', json: row['value'] })[0];
    }
    return balanceHistory;
}
async function importCoinBalanceHistory(chainHistory, contract, limit) {
    console.log(`${(new Date()).toLocaleTimeString()} importCoinBalanceHistory for ${contract} through ${limit}`);
    let coinQueryOffset = 0;
    let lastRecodedBlock = 0;
    if (chainHistory[contract] === undefined) {
        chainHistory[contract] = {};
    }
    else {
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
        // const coinHistory = await getContractBalanceHistory(contract, coinQueryOffset, querySize);
        const coinHistory = await getContractStorageHistory(contract, coinQueryOffset, querySize);
        if (Object.keys(coinHistory).length === 0) {
            break;
        }
        Object.keys(coinHistory).map(level => {
            if (chainHistory[contract][level] === undefined) {
                chainHistory[contract][level] = {};
            }
            ;
            chainHistory[contract][level].coinBalance = coinHistory[level];
            lastRecodedBlock = Math.max(lastRecodedBlock, Number(level));
        });
        coinQueryOffset += querySize;
    }
    console.log(`${(new Date()).toLocaleTimeString()} importCoinBalanceHistory, fetched til ${lastRecodedBlock}`);
    return chainHistory;
}
async function importTokenBalanceHistory(chainHistory, contract, limit) {
    console.log(`${(new Date()).toLocaleTimeString()} importTokenBalanceHistory for ${contract} through ${limit}`);
    let tokenQueryOffset = 0;
    let lastRecodedBlock = 0;
    if (chainHistory[contract] === undefined) {
        chainHistory[contract] = {};
    }
    else {
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
        if (Object.keys(tokenHistory).length === 0) {
            break;
        }
        Object.keys(tokenHistory).map(level => {
            if (chainHistory[contract][level] === undefined) {
                chainHistory[contract][level] = {};
            }
            ;
            chainHistory[contract][level].tokenBalance = tokenHistory[level];
            lastRecodedBlock = Math.max(lastRecodedBlock, Number(level));
        });
        tokenQueryOffset += querySize;
    }
    console.log(`${(new Date()).toLocaleTimeString()} importTokenBalanceHistory, fetched til ${lastRecodedBlock}`);
    return chainHistory;
}
async function importContractTransactions(chainHistory, contract, limit) {
    console.log(`${(new Date()).toLocaleTimeString()} importContractTransactions for ${contract.address} through ${limit}`);
    let queryStartBlock = contract.deploymentBlock;
    if (chainHistory[contract.address] === undefined) {
        chainHistory[contract.address] = {};
    }
    else {
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
    console.log(`${(new Date()).toLocaleTimeString()} importContractTransactions, fetching`);
    while (queryStartBlock < limit) {
        console.log(`${(new Date()).toLocaleTimeString()} importContractTransactions, querying ${Number(queryStartBlock)} ... ${Number(queryStartBlock) + querySize}`);
        const result = await getContractTransactions(contract.address, contract.entrypoints, Number(queryStartBlock), Number(queryStartBlock) + querySize);
        const operationHistory = result.operations;
        Object.keys(operationHistory).map(level => {
            if (chainHistory[contract.address][level] === undefined) {
                chainHistory[contract.address][level] = {};
            }
            ;
            const levelOperations = operationHistory[level];
            chainHistory[contract.address][level].operations = {};
            for (const operation of levelOperations) {
                if (operation['coinAmount'] !== undefined) {
                    chainHistory[contract.address][level].operations[operation.hash] = {
                        receiver: operation.operator,
                        coinAmount: operation.coinAmount,
                        tokenAmount: operation.tokenAmount
                    };
                }
                else {
                    chainHistory[contract.address][level].operations[operation.hash] = {
                        receiver: operation.operator,
                        input: operation.input,
                        amount: operation.amount
                    };
                }
            }
            chainHistory[contract.address][level].timestamp = result.timestamps[level];
            chainHistory[contract.address][level].price = result.quotes[level];
        });
        queryStartBlock = Math.min(Number(queryStartBlock) + querySize, Number(limit));
    }
    console.log(`${(new Date()).toLocaleTimeString()} importContractTransactions, fetched til ${queryStartBlock}`);
    return chainHistory;
}
async function importSupplyHistory(chainHistory, contract, limit) {
    console.log(`${(new Date()).toLocaleTimeString()} importSupplyHistory for ${contract} through ${limit}`);
    let supplyQueryOffset = 0;
    let lastRecodedBlock = 0;
    if (chainHistory[contract] === undefined) {
        chainHistory[contract] = {};
    }
    else {
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
        if (Object.keys(supplyHistory).length === 0) {
            break;
        }
        Object.keys(supplyHistory).map(level => {
            if (chainHistory[contract][level] === undefined) {
                chainHistory[contract][level] = {};
            }
            ;
            chainHistory[contract][level].totalSupply = supplyHistory[level];
            lastRecodedBlock = Math.max(lastRecodedBlock, Number(level));
        });
        supplyQueryOffset += querySize;
        if (++i % 10 === 0) {
            console.log(`${(new Date()).toLocaleTimeString()} importSupplyHistory at ${lastRecodedBlock}`);
        }
    }
    console.log(`${(new Date()).toLocaleTimeString()} importSupplyHistory, fetched til ${lastRecodedBlock}`);
    return chainHistory;
}
async function importBlockCoinPrice(chainHistory, contract) {
    console.log(`${(new Date()).toLocaleTimeString()} importBlockCoinPrice for ${contract}`);
    const recordedBlocks = Object.keys(chainHistory[contract]).sort((a, b) => Number(a) - Number(b));
    let i = 0;
    for await (const level of recordedBlocks) {
        if (chainHistory[contract][level].price !== undefined) {
            continue;
        }
        const url = `https://api.tzkt.io/v1/blocks/${level}?quote=usd`;
        const result = await fetch(`${url}`, { method: 'GET', cache: 'no-cache' });
        const data = await result.json();
        chainHistory[contract][level].price = data['quote']['usd'];
        chainHistory[contract][level].timestamp = data['timestamp'];
        if (++i % 100 === 0) {
            console.log(`${(new Date()).toLocaleTimeString()} importBlockCoinPrice at ${level}`);
        }
    }
    return chainHistory;
}
function exportSupplySeries(chainHistory, contract, skip = true) {
    let series = '';
    const keys = Object.keys(chainHistory[contract]).sort((a, b) => Number(a) - Number(b));
    let previousSupply = 0;
    for (const level of keys) {
        let currentSupply = previousSupply;
        if (chainHistory[contract][level]['totalSupply'] !== undefined) {
            currentSupply = chainHistory[contract][level]['totalSupply'];
            previousSupply = currentSupply;
        }
        else if (skip) {
            continue;
        }
        series += `${level},${currentSupply}\n`;
    }
    fs_1.default.writeFileSync('supply.csv', series);
}
function exportYieldSeries(chainHistory, contract) {
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
            let startingTokenBalance = Number(chainHistory[contract][previousLevel].tokenBalance);
            if ((startingCoinBalance === undefined || isNaN(startingCoinBalance)) && startingTokenBalance !== undefined) {
                console.log(`missing startingCoinBalance at ${level}/${previousLevel}`);
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
            }
            else if (startingCoinBalance !== undefined && (startingTokenBalance === undefined || isNaN(startingTokenBalance))) {
                console.log(`missing startingTokenBalance at ${level}/${previousLevel}`);
                let levelIndex = keys.indexOf(`${previousLevel}`);
                const limit = Math.max(levelIndex - 10, 0);
                while (levelIndex > limit) {
                    if (startingCoinBalance === chainHistory[contract][keys[levelIndex]].coinBalance && chainHistory[contract][keys[levelIndex]].tokenBalance !== undefined) {
                        startingTokenBalance = Number(chainHistory[contract][keys[levelIndex]].tokenBalance);
                        break;
                    }
                    --levelIndex;
                }
                if (startingTokenBalance === undefined) {
                    console.log(`missing startingTokenBalance at ${level}`);
                    continue;
                }
            }
            // apply LP changes
            for (const hash of Object.keys(chainHistory[contract][level]['operations'])) {
                const operation = chainHistory[contract][level]['operations'][hash];
                if (operation['coinAmount'] !== undefined) {
                    console.log('updating liquidity');
                    console.log(`${Number(startingTokenBalance)} + ${Number(operation['tokenAmount'])}`);
                    console.log(`${Number(startingCoinBalance)} + ${Number(operation['coinAmount'])}`);
                    startingTokenBalance = Number(startingTokenBalance) + Number(operation['tokenAmount']);
                    startingCoinBalance = Number(startingCoinBalance) + Number(operation['coinAmount']);
                    console.log('updated', startingTokenBalance, startingCoinBalance);
                }
            }
            let anchorCoinBalance = startingCoinBalance;
            let anchorTokenBalance = startingTokenBalance;
            let endingCoinBalance = chainHistory[contract][level].coinBalance;
            let endingTokenBalance = chainHistory[contract][level].tokenBalance;
            let expectedCoinDiff = 0;
            let expectedTokenDiff = 0;
            // apply swaps
            for (const hash of Object.keys(chainHistory[contract][level]['operations'])) {
                const operation = chainHistory[contract][level]['operations'][hash];
                if (operation.input === 'token') {
                    const expectedResult = getTokenToCashExchangeRate(operation.amount.toString(), startingTokenBalance.toString(), startingCoinBalance.toString());
                    expectedCoinDiff -= Number(expectedResult.cashAmount);
                    expectedTokenDiff += Number(operation.amount);
                    const reducedResult = getTokenToCashExchangeRate(operation.amount.toString(), startingTokenBalance.toString(), startingCoinBalance.toString(), 997);
                    startingCoinBalance -= Number(reducedResult.cashAmount);
                    startingTokenBalance += Number(operation.amount);
                    console.log(`full c: ${expectedResult.cashAmount}, partial: ${reducedResult.cashAmount}`);
                }
                else if (operation.input === 'coin') {
                    const expectedResult = getCashToTokenExchangeRate(operation.amount.toString(), startingTokenBalance.toString(), startingCoinBalance.toString());
                    expectedTokenDiff -= Number(expectedResult.tokenAmount);
                    expectedCoinDiff += Number(operation.amount);
                    const reducedResult = getCashToTokenExchangeRate(operation.amount.toString(), startingTokenBalance.toString(), startingCoinBalance.toString(), 997);
                    startingTokenBalance -= Number(reducedResult.tokenAmount);
                    startingCoinBalance += Number(operation.amount);
                    console.log(`full t: ${expectedResult.tokenAmount}, partial: ${reducedResult.tokenAmount}`);
                }
            }
            const coinRevenue = Number(endingCoinBalance) - anchorCoinBalance - expectedCoinDiff;
            const tokenRevenue = Number(endingTokenBalance) - anchorTokenBalance - expectedTokenDiff;
            console.log(`${level} from ${previousLevel}`);
            console.log(`starting ${anchorCoinBalance}c, ${anchorTokenBalance}t`);
            console.log(`intra    ${startingCoinBalance}c, ${startingTokenBalance}t`);
            console.log(`ending   ${endingCoinBalance}c, ${endingTokenBalance}t`);
            console.log(`diff ${Number(endingCoinBalance) - Number(anchorCoinBalance)}c, ${Number(endingTokenBalance) - Number(anchorTokenBalance)}t`);
            console.log(`exp  ${expectedCoinDiff}c, ${expectedTokenDiff}t`);
            console.log(`revenue ${coinRevenue}c, ${tokenRevenue}t`);
            previousLevel = Number(level);
            rawRevenue[level] = {
                timestamp: chainHistory[contract][level].timestamp,
                coinRevenue: coinRevenue,
                tokenRevenue: tokenRevenue,
                coinBalance: endingCoinBalance,
                tokenBalance: endingTokenBalance,
                coinPrice: chainHistory[contract][level].price
            };
        }
        catch (err) {
            console.log(`exportYieldSeries failed at ${level}`);
            throw err;
        }
    }
    console.log('raw revenue', rawRevenue);
    const dailyRevenue = {};
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
            };
        }
        else {
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
    // console.log('revenue', dailyRevenue)
    const dollarizedRevenue = {};
    for (const date of Object.keys(dailyRevenue)) {
        const tvl = (Number(dailyRevenue[date].coinBalance) * dailyRevenue[date].coinPrice + Number(dailyRevenue[date].tokenBalance)) / 1000000;
        const revenue = (Number(dailyRevenue[date].coinRevenue) * dailyRevenue[date].coinPrice + Number(dailyRevenue[date].tokenRevenue)) / 1000000;
        dollarizedRevenue[date] = {
            tvl,
            revenue,
            rr: revenue / tvl,
            apr: revenue * 365 / tvl
        };
    }
    console.log('dollarized revenue', dollarizedRevenue);
    fs_1.default.writeFileSync('./dollarizedRevenue.json', JSON.stringify(dollarizedRevenue, undefined, 4));
    let csvDollarizedRevenue = 'timestamp,tvl,revenue,rr,apr\n';
    for (const date of Object.keys(dollarizedRevenue)) {
        const row = dollarizedRevenue[date];
        csvDollarizedRevenue += `${date},${row['tvl']},${row['revenue']},${row['rr']},${row['apr']}\n`;
    }
    fs_1.default.writeFileSync('./dollarizedRevenue.csv', csvDollarizedRevenue);
}
async function run() {
    const contracts = [
        {
            name: 'QuipuSwap USDtz',
            address: 'KT1WxgZ1ZSfMgmsSDDcUn8Xn577HwnQ7e1Lb',
            // deploymentBlock: 1434933,
            deploymentBlock: 3183435,
            entrypoints: ['tezToTokenPayment', 'tokenToTezPayment', 'investLiquidity', 'divestLiquidity']
            // JSONpaths
            // history file path
        }
    ];
    // const head = 1434933 + 1_000;
    // const head = 1434933 + 500_000;
    // const head = await getLastBlockLevel();
    const head = 3183435 + 1000;
    let chainHistory = {};
    try {
        chainHistory = JSON.parse(fs_1.default.readFileSync('./chainHistory.json').toString());
    }
    catch (_a) { }
    for (const contract of contracts) {
        chainHistory = await importCoinBalanceHistory(chainHistory, contract.address, head);
        fs_1.default.writeFileSync('./chainHistory.json', JSON.stringify(chainHistory, undefined, 4));
        chainHistory = await importTokenBalanceHistory(chainHistory, contract.address, head);
        fs_1.default.writeFileSync('./chainHistory.json', JSON.stringify(chainHistory, undefined, 4));
        chainHistory = await importContractTransactions(chainHistory, contract, head);
        fs_1.default.writeFileSync('./chainHistory.json', JSON.stringify(chainHistory, undefined, 4));
    }
    // fs.writeFileSync('./chainHistory.json', JSON.stringify(chainHistory, undefined, 4));
    // exportSupplySeries(chainHistory, 'KT1WxgZ1ZSfMgmsSDDcUn8Xn577HwnQ7e1Lb');
    // exportYieldSeries(chainHistory, 'KT1WxgZ1ZSfMgmsSDDcUn8Xn577HwnQ7e1Lb');
}
run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
// https://api.tzkt.io/#operation/BigMaps_GetBigMapUpdates
