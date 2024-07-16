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
const fs_1 = __importDefault(require("fs"));
const jsonpath_plus_1 = require("jsonpath-plus");
const fetch = __importStar(require("node-fetch"));
const usdtzTokenLedgerMapId = 36;
const querySize = 5000;
async function getLastBlockLevel() {
    const url = 'https://api.tzkt.io/v1/blocks/count';
    const result = await fetch(url, { method: 'GET', cache: 'no-cache' });
    const data = await result.text();
    return Number(data);
}
async function getContractTransactions(contract, entrypoints, startBlock, endBlock) {
    const fields = ['level', 'hash', 'amount', 'parameter', 'sender', 'timestamp', 'quote']; // 'initiator'
    const url = 'https://api.tzkt.io/v1/operations/transactions';
    const params = `target=${contract}&level.lt=${endBlock}&level.ge=${startBlock}&entrypoint.in=${entrypoints.join(',')}&sort=level&select=${fields.join(',')}&status=applied&quote=Usd&limit=${querySize}`;
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
        if (row['parameter']['entrypoint'] === 'addLiquidity') {
            operationHistory[row['level']].push({
                hash: row['hash'],
                operator: row['sender']['address'],
                coinAmount: row['amount'],
                tokenAmount: row['parameter']['value']['maxTokensDeposited']
            });
        }
        else if (row['parameter']['entrypoint'] === 'removeLiquidity') {
            operationHistory[row['level']].push({
                hash: row['hash'],
                operator: row['sender']['address'],
                coinAmount: `-${row['parameter']['value']['minXtzWithdrawn']}`,
                tokenAmount: `-${row['parameter']['value']['minTokensWithdrawn']}`
            });
        }
        else if (row['amount'] === 0) { // tokenToXtz
            operationHistory[row['level']].push({
                hash: row['hash'],
                operator: row['sender']['address'],
                input: 'token',
                amount: (0, jsonpath_plus_1.JSONPath)({ path: '$.value.tokensSold', json: row['parameter'] })[0]
            });
        }
        else { // xtzToToken
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
async function getContractInternalBalanceHistory(contract) {
    let offset = 0; // 0 is the most recent record
    const limit = 1730610;
    let lastRecodedBlock = Number.MAX_VALUE;
    const url = `https://api.tzkt.io/v1/contracts/${contract}/storage/history`;
    const balanceHistory = {};
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
            balanceHistory[row['level']] = (0, jsonpath_plus_1.JSONPath)({ path: '$.xtzPool', json: row['value'] })[0];
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
async function importInternalCoinBalanceHistory(chainHistory, contract, limit) {
    console.log(`${(new Date()).toLocaleTimeString()} importInternalCoinBalanceHistory for ${contract} through ${limit}`);
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
        const coinHistory = await getContractInternalBalanceHistory(contract);
        if (Object.keys(coinHistory).length === 0) {
            break;
        }
        Object.keys(coinHistory).map(level => {
            if (chainHistory[contract][level] === undefined) {
                chainHistory[contract][level] = {};
            }
            ;
            chainHistory[contract][level].internalCoinBalance = coinHistory[level];
            lastRecodedBlock = Math.max(lastRecodedBlock, Number(level));
        });
        coinQueryOffset += querySize;
        // console.log(`importInternalCoinBalanceHistory, ${lastRecodedBlock < limit}, ${lastRecodedBlock}, ${limit}`)
    }
    console.log(`${(new Date()).toLocaleTimeString()} importInternalCoinBalanceHistory, fetched til ${lastRecodedBlock}`);
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
    queryStartBlock = contract.deploymentBlock;
    console.log(`${(new Date()).toLocaleTimeString()} importContractTransactions, fetching`);
    while (queryStartBlock < limit) {
        console.log(`${(new Date()).toLocaleTimeString()} importContractTransactions, querying ${Number(queryStartBlock)} ... ${Number(queryStartBlock) + querySize}`);
        const result = await getContractTransactions(contract.address, contract.entrypoints, Number(queryStartBlock), Number(queryStartBlock) + querySize);
        const operationHistory = result.operations;
        let lastLevel = 0;
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
            lastLevel = Math.max(lastLevel, Number(level));
        });
        console.log('last', lastLevel);
        queryStartBlock = Math.min(Number(queryStartBlock) + querySize, Number(limit));
    }
    console.log(`${(new Date()).toLocaleTimeString()} importContractTransactions, fetched til ${queryStartBlock}`);
    return chainHistory;
}
async function run() {
    const filePrefix = 'vortex_';
    const historyFile = `./${filePrefix}history.json`;
    const contracts = [
        {
            name: 'Vortex USDtz',
            address: 'KT19HdcBJw8XJkDYKLr6ez9KkhhuS8MYUdcs',
            deploymentBlock: 1730610,
            entrypoints: ['xtzToToken', 'tokenToXtz', 'addLiquidity', 'removeLiquidity']
        }
    ];
    const head = await getLastBlockLevel();
    let chainHistory = {};
    try {
        chainHistory = JSON.parse(fs_1.default.readFileSync(historyFile).toString());
    }
    catch (err) {
        console.log(`failed to parse chainHistory at ${historyFile} due to ${err}`);
    }
    for (const contract of contracts) {
        chainHistory = await importTokenBalanceHistory(chainHistory, contract.address, head);
        fs_1.default.writeFileSync(historyFile, JSON.stringify(chainHistory, undefined, 4));
        // chainHistory = await importContractTransactions(chainHistory, contract, head);
        // fs.writeFileSync(historyFile, JSON.stringify(chainHistory, undefined, 4));
        // chainHistory = await importInternalCoinBalanceHistory(chainHistory, contract.address, head);
        // fs.writeFileSync(historyFile, JSON.stringify(chainHistory, undefined, 4));
    }
}
run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
// https://api.tzkt.io/#operation/BigMaps_GetBigMapUpdates
