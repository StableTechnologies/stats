"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const big_integer_1 = __importDefault(require("big-integer"));
const fs_1 = __importDefault(require("fs"));
function getCashToTokenExchangeRate(cashAmount, tokenBalance, cashBalance, rate = 1000) {
    try {
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
    catch (err) {
        console.error(`getCashToTokenExchangeRate failed with "${err}" for ${cashAmount}, ${tokenBalance}, ${cashBalance}, ${rate}`);
        throw err;
    }
}
function getTokenToCashExchangeRate(tokenAmount, tokenBalance, cashBalance, rate = 1000) {
    try {
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
    catch (err) {
        console.error(`getTokenToCashExchangeRate failed with "${err}" for ${tokenAmount}, ${tokenBalance}, ${cashBalance}, ${rate}`);
        throw err;
    }
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
            }
            else if (startingCoinBalance !== undefined && (startingTokenBalance === undefined || isNaN(startingTokenBalance))) {
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
                    console.log('updating liquidity');
                    console.log(`${Number(startingTokenBalance)} + ${Number(operation['tokenAmount'])}`);
                    console.log(`${Number(startingCoinBalance)} + ${Number(operation['coinAmount'])}`);
                    startingTokenBalance += Number(operation['tokenAmount']);
                    startingCoinBalance += Number(operation['coinAmount']);
                    startingInternalCoinBalance += Number(operation['coinAmount']);
                    console.log('updated', startingTokenBalance, startingCoinBalance);
                }
            }
            let anchorCoinBalance = startingCoinBalance;
            let anchorInternalCoinBalance = startingCoinBalance;
            let anchorTokenBalance = startingTokenBalance;
            let endingCoinBalance = chainHistory[contract][level].coinBalance;
            let endingTokenBalance = chainHistory[contract][level].tokenBalance;
            let expectedCoinDiff = 0;
            let expectedTokenDiff = 0;
            // apply swaps
            let volume = 0;
            let coinRevenue = 0;
            let tokenRevenue = 0;
            for (const hash of Object.keys(chainHistory[contract][level]['operations'])) {
                const operation = chainHistory[contract][level]['operations'][hash];
                if (operation.input === 'token') {
                    const expectedResult = getTokenToCashExchangeRate(operation.amount.toString(), startingTokenBalance.toString(), anchorInternalCoinBalance.toString());
                    expectedCoinDiff -= Number(expectedResult.cashAmount);
                    expectedTokenDiff += Number(operation.amount);
                    const reducedResult = getTokenToCashExchangeRate(operation.amount.toString(), startingTokenBalance.toString(), anchorInternalCoinBalance.toString(), 997);
                    anchorInternalCoinBalance -= Number(reducedResult.cashAmount);
                    startingTokenBalance += Number(operation.amount);
                    volume += Number(expectedResult.cashAmount);
                    coinRevenue += Number(expectedResult.cashAmount) - Number(reducedResult.cashAmount);
                }
                else if (operation.input === 'coin') {
                    const expectedResult = getCashToTokenExchangeRate(operation.amount.toString(), startingTokenBalance.toString(), anchorInternalCoinBalance.toString());
                    expectedTokenDiff -= Number(expectedResult.tokenAmount);
                    expectedCoinDiff += Number(operation.amount);
                    const reducedResult = getCashToTokenExchangeRate(operation.amount.toString(), startingTokenBalance.toString(), anchorInternalCoinBalance.toString(), 997);
                    startingTokenBalance -= Number(reducedResult.tokenAmount);
                    anchorInternalCoinBalance += Number(operation.amount);
                    volume += Number(operation.amount);
                    tokenRevenue += Number(expectedResult.tokenAmount) - Number(reducedResult.tokenAmount);
                }
            }
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
            console.log(`exp  ${expectedCoinDiff}c, ${expectedTokenDiff}t`);
            console.log(`revenue ${coinRevenue}c, ${tokenRevenue}t`);
            previousLevel = Number(level);
            rawRevenue[level] = {
                timestamp: chainHistory[contract][level].timestamp,
                coinRevenue: coinRevenue,
                tokenRevenue: tokenRevenue,
                coinBalance: endingCoinBalance,
                tokenBalance: endingTokenBalance,
                coinPrice: chainHistory[contract][level].price,
                volume
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
                coinPrice: rawRevenue[level].coinPrice,
                volume: rawRevenue[level].volume
            };
        }
        else {
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
        const tvl = (Number(dailyRevenue[date].coinBalance) * dailyRevenue[date].coinPrice + Number(dailyRevenue[date].tokenBalance)) / 1000000;
        const revenue = (Number(dailyRevenue[date].coinRevenue) * dailyRevenue[date].coinPrice + Number(dailyRevenue[date].tokenRevenue)) / 1000000;
        dollarizedRevenue[date] = {
            tvl,
            revenue,
            volume: dailyRevenue[date].volume / 1000000 * dailyRevenue[date].coinPrice,
            rr: revenue / tvl,
            apr: revenue * 365 / tvl
        };
    }
    console.log('dollarized revenue', dollarizedRevenue);
    fs_1.default.writeFileSync('./dollarizedRevenue.json', JSON.stringify(dollarizedRevenue, undefined, 4));
    let csvDollarizedRevenue = 'timestamp,volume,tvl,revenue,rr,apr\n';
    for (const date of Object.keys(dollarizedRevenue)) {
        const row = dollarizedRevenue[date];
        csvDollarizedRevenue += `${date},${row['volume']},${row['tvl']},${row['revenue']},${row['rr']},${row['apr']}\n`;
    }
    fs_1.default.writeFileSync('./dollarizedRevenue.csv', csvDollarizedRevenue);
}
async function run() {
    const filePrefix = 'quipu_v1_';
    const historyFile = `./${filePrefix}history.json`;
    let chainHistory = {};
    try {
        chainHistory = JSON.parse(fs_1.default.readFileSync(historyFile).toString());
    }
    catch (err) {
        console.log(`failed to parse chainHistory at ${historyFile} due to ${err}`);
    }
    // exportSupplySeries(chainHistory, Object.keys(chainHistory)[0]);
    exportYieldSeries(chainHistory, Object.keys(chainHistory)[0]);
}
run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
// https://api.tzkt.io/#operation/BigMaps_GetBigMapUpdates
