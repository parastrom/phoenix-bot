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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.delay = exports.execute = void 0;
const web3_js_1 = require("@solana/web3.js");
const phoenixSdk = __importStar(require("@ellipsis-labs/phoenix-sdk"));
require('dotenv').config();
const execute = () => __awaiter(void 0, void 0, void 0, function* () {
    const REFRESH_INTERVAL = 2000; // 2 minutes
    const MAX_ITER = 3;
    const ORDER_LIFETIME = 7; // 7 Seconds
    const TICKSIZE = 0.01;
    let counter = 0;
    if (!process.env.PRIVATE_KEY) {
        throw new Error("PRIVATE_KEY is not defined");
    }
    let privKeyArray;
    try {
        privKeyArray = JSON.parse(process.env.PRIVATE_KEY);
    }
    catch (err) {
        throw new Error("PRIVATE_KEY is not a valid - must be a JSON array");
    }
    let traderKeyPair = web3_js_1.Keypair.fromSecretKey(new Uint8Array(privKeyArray));
    const marketPubKey = new web3_js_1.PublicKey("4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg");
    const endpoint = "https://api.mainnet-beta.solana.com";
    const connection = new web3_js_1.Connection(endpoint, "confirmed");
    const client = yield phoenixSdk.Client.create(connection);
    const marketState = client.marketStates.get(marketPubKey.toString());
    const marketData = marketState === null || marketState === void 0 ? void 0 : marketState.data;
    if (!marketData) {
        throw new Error("Market data is not available");
    }
    yield setupMaker(connection, marketState, traderKeyPair);
    do {
        yield cancelAllOrders(connection, client, marketPubKey, traderKeyPair);
        try {
            const price = yield fetchSOLPrice();
            const { bid, ask } = calculateBidAsk(price, TICKSIZE);
            console.log(`SOL price : ${price} |  bid: ${bid} | ask: ${ask}`);
            const currentTime = Math.floor(Date.now() / 1000);
            const bidOrderTemplate = createLimitOrderTemplate(phoenixSdk.Side.Bid, bid, currentTime, ORDER_LIFETIME);
            const askOrderTemplate = createLimitOrderTemplate(phoenixSdk.Side.Ask, ask, currentTime, ORDER_LIFETIME);
            let instructions = [];
            if (counter < MAX_ITER) {
                instructions = [
                    client.getLimitOrderInstructionfromTemplate(marketPubKey.toBase58(), traderKeyPair.publicKey, bidOrderTemplate),
                    client.getLimitOrderInstructionfromTemplate(marketPubKey.toBase58(), traderKeyPair.publicKey, askOrderTemplate),
                ];
            }
            if (counter === MAX_ITER) {
                const withdrawParams = {
                    quoteLotsToWithdraw: null,
                    baseLotsToWithdraw: null,
                };
                const placeWithdraw = client.createWithdrawFundsInstruction({
                    withdrawFundsParams: withdrawParams,
                }, marketPubKey.toString(), traderKeyPair.publicKey);
                instructions.push(placeWithdraw);
            }
            yield placeQuotes(connection, instructions, traderKeyPair, marketState, bid, ask);
            counter += 1;
            yield (0, exports.delay)(REFRESH_INTERVAL);
        }
        catch (err) {
            console.error(err);
        }
        counter += 1;
        yield (0, exports.delay)(REFRESH_INTERVAL);
    } while (counter < MAX_ITER);
});
exports.execute = execute;
function setupMaker(connection, marketState, traderKeyPair) {
    return __awaiter(this, void 0, void 0, function* () {
        const setupNewMakerIxs = yield phoenixSdk.getMakerSetupInstructionsForMarket(connection, marketState, traderKeyPair.publicKey);
        if (setupNewMakerIxs.length !== 0) {
            const setup = new web3_js_1.Transaction().add(...setupNewMakerIxs);
            const setupTxId = yield (0, web3_js_1.sendAndConfirmTransaction)(connection, setup, [traderKeyPair], {
                skipPreflight: false,
                commitment: "confirmed",
            });
            console.log(`Setup Tx Link: https://beta.solscan.io/tx/${setupTxId}`);
        }
        else {
            console.log("Maker already setup");
        }
    });
}
function cancelAllOrders(connection, client, marketPubKey, traderKeyPair) {
    return __awaiter(this, void 0, void 0, function* () {
        const cancelAll = client.createCancelAllOrdersInstruction(marketPubKey.toString(), traderKeyPair.publicKey);
        try {
            const cancelTransaction = new web3_js_1.Transaction().add(cancelAll);
            const txid = yield (0, web3_js_1.sendAndConfirmTransaction)(connection, cancelTransaction, [traderKeyPair], {
                skipPreflight: false,
                commitment: "confirmed",
            });
            console.log(`Cancel Tx Link: https://beta.solscan.io/tx/${txid}`);
        }
        catch (err) {
            console.error(err);
            return;
        }
    });
}
function fetchSOLPrice() {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetch("https://api.coinbase.com/v2/prices/SOL-USD/spot");
        const data = yield response.json();
        return parseFloat((_b = (_a = data === null || data === void 0 ? void 0 : data.data) === null || _a === void 0 ? void 0 : _a.amount) !== null && _b !== void 0 ? _b : "");
    });
}
function createLimitOrderTemplate(side, price, currentTime, orderLifetime) {
    return {
        side,
        priceAsFloat: price,
        sizeInBaseUnits: 1,
        selfTradeBehavior: phoenixSdk.SelfTradeBehavior.Abort,
        clientOrderId: 1,
        useOnlyDepositedFunds: false,
        lastValidSlot: undefined,
        lastValidUnixTimestampInSeconds: currentTime + orderLifetime,
    };
}
function placeQuotes(connection, instructions, traderKeyPair, marketState, bid, ask) {
    return __awaiter(this, void 0, void 0, function* () {
        const placeQuotesTx = new web3_js_1.Transaction().add(...instructions);
        const placeQuotesTxId = yield (0, web3_js_1.sendAndConfirmTransaction)(connection, placeQuotesTx, [traderKeyPair], {
            skipPreflight: true,
            commitment: "confirmed",
        });
        console.log("Place quotes", bid.toFixed(marketState.getPriceDecimalPlaces()), "@", ask.toFixed(marketState.getPriceDecimalPlaces()));
        console.log(`Place Quotes Tx Link: https://beta.solscan.io/tx/${placeQuotesTxId}`);
    });
}
function calculateBidAsk(price, tickSize) {
    const bps = 250 / 10000;
    let bid = price * (1 - bps);
    let ask = price * (1 + bps);
    bid = Math.floor(bid / tickSize) * tickSize;
    ask = Math.ceil(ask / tickSize) * tickSize;
    return { bid, ask };
}
const delay = (ms) => new Promise((res) => setTimeout(res, ms));
exports.delay = delay;
(0, exports.execute)();
