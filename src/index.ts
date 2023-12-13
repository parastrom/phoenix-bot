import { Keypair, 
    Connection, 
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
    TransactionInstruction,
} from "@solana/web3.js";

import * as phoenixSdk from "@ellipsis-labs/phoenix-sdk"
require('dotenv').config();

export const execute = async () => {
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
    } catch (err) {
        throw new Error("PRIVATE_KEY is not a valid - must be a JSON array");
    }

    let traderKeyPair = Keypair.fromSecretKey(new Uint8Array(privKeyArray));
    const marketPubKey = new PublicKey("4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg");

    const endpoint = "https://api.mainnet-beta.solana.com";
    const connection = new Connection(endpoint, "confirmed");

    const client = await phoenixSdk.Client.create(connection);

    const marketState = client.marketStates.get(marketPubKey.toString());
    const marketData = marketState?.data;

    if (!marketData) {
        throw new Error("Market data is not available");
    }

    await setupMaker(connection, marketState, traderKeyPair);

    do {
        await cancelAllOrders(connection, client, marketPubKey, traderKeyPair);

        try {
            const price = await fetchSOLPrice();
            const { bid, ask } = calculateBidAsk(price, TICKSIZE);

            console.log(`SOL price : ${price} |  bid: ${bid} | ask: ${ask}`);

            const currentTime = Math.floor(Date.now() / 1000);

            const bidOrderTemplate = createLimitOrderTemplate(phoenixSdk.Side.Bid, bid, currentTime, ORDER_LIFETIME);
            const askOrderTemplate = createLimitOrderTemplate(phoenixSdk.Side.Ask, ask, currentTime, ORDER_LIFETIME);

            let instructions: TransactionInstruction[] = [];
            if (counter < MAX_ITER) {
                instructions = [
                    client.getLimitOrderInstructionfromTemplate(
                        marketPubKey.toBase58(),
                        traderKeyPair.publicKey,
                        bidOrderTemplate,
                    ),
                    client.getLimitOrderInstructionfromTemplate(
                        marketPubKey.toBase58(),
                        traderKeyPair.publicKey,
                        askOrderTemplate,
                    ),
                ];
            }

            if (counter === MAX_ITER) {
                const withdrawParams: phoenixSdk.WithdrawParams = {
                    quoteLotsToWithdraw: null,
                    baseLotsToWithdraw: null,
                };

                const placeWithdraw = client.createWithdrawFundsInstruction(
                    {
                        withdrawFundsParams: withdrawParams,
                    },
                    marketPubKey.toString(),
                    traderKeyPair.publicKey,
                );
                instructions.push(placeWithdraw);
            }

            await placeQuotes(connection, instructions, traderKeyPair, marketState, bid, ask);

            counter += 1;
            await delay(REFRESH_INTERVAL);
        } catch (err) {
            console.error(err);
        }

        counter += 1;
        await delay(REFRESH_INTERVAL);
    } while (counter < MAX_ITER);
};

async function setupMaker(
    connection: Connection, 
    marketState: phoenixSdk.MarketState, 
    traderKeyPair: Keypair) {
    const setupNewMakerIxs = await phoenixSdk.getMakerSetupInstructionsForMarket(
        connection,
        marketState,
        traderKeyPair.publicKey,
    );

    if (setupNewMakerIxs.length !== 0) {
        const setup = new Transaction().add(...setupNewMakerIxs);
        const setupTxId = await sendAndConfirmTransaction(
            connection,
            setup,
            [traderKeyPair],
            {
                skipPreflight: false,
                commitment: "confirmed",
            }
        );
        console.log(`Setup Tx Link: https://beta.solscan.io/tx/${setupTxId}`);
    } else {
        console.log("Maker already setup");
    }
}

async function cancelAllOrders(
    connection: Connection, 
    client: phoenixSdk.Client, 
    marketPubKey: PublicKey, 
    traderKeyPair: Keypair) {
    const cancelAll = client.createCancelAllOrdersInstruction(
        marketPubKey.toString(),
        traderKeyPair.publicKey,
    );

    try {
        const cancelTransaction = new Transaction().add(cancelAll);
        const txid = await sendAndConfirmTransaction(
            connection,
            cancelTransaction,
            [traderKeyPair],
            {
                skipPreflight: false,
                commitment: "confirmed",
            }
        );

        console.log(`Cancel Tx Link: https://beta.solscan.io/tx/${txid}`);
    } catch (err) {
        console.error(err);
        return;
    }
}

async function fetchSOLPrice() {
    const response = await fetch(
        "https://api.coinbase.com/v2/prices/SOL-USD/spot"
    );
    const data: any = await response.json();
    return parseFloat(data?.data?.amount ?? "");
}

function createLimitOrderTemplate(
    side: phoenixSdk.Side,
    price: number,
    currentTime: number, 
    orderLifetime: number): phoenixSdk.LimitOrderTemplate {
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

async function placeQuotes(
    connection: Connection, 
    instructions: TransactionInstruction[], 
    traderKeyPair: Keypair, 
    marketState: phoenixSdk.MarketState,
    bid: number,
    ask: number) {

    const placeQuotesTx = new Transaction().add(...instructions);

    const placeQuotesTxId = await sendAndConfirmTransaction(
        connection,
        placeQuotesTx,
        [traderKeyPair],
        {
            skipPreflight: true,
            commitment: "confirmed",
        }
    );

    console.log(
        "Place quotes",
        bid.toFixed(marketState.getPriceDecimalPlaces()),
        "@",
        ask.toFixed(marketState.getPriceDecimalPlaces())
    );

    console.log(`Place Quotes Tx Link: https://beta.solscan.io/tx/${placeQuotesTxId}`);
}

function calculateBidAsk(price: number, tickSize: number): { bid: number, ask: number } {
    const bps = 250 / 10000;

    let bid = price * (1 - bps);
    let ask = price * (1 + bps);

    bid = Math.floor(bid / tickSize) * tickSize;
    ask = Math.ceil(ask / tickSize) * tickSize;

    return { bid, ask };
}

export const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

execute();

