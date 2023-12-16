import * as ccxt from 'ccxt';
import { OrderManager, OrderType } from './orderManagement';
import { getConnection, getMarketAddress, getTraderKeyPair, getMarketState } from './marketUtils';
import { calculateEMA, calculateBands, stddev } from './simple_features';
import { PublicKey } from '@solana/web3.js';
import * as phoenixSdk from '@ellipsis-labs/phoenix-sdk';

// Constants
const REFRESH_INTERVAL = 10000; // in milliseconds
const EDGE = 0.01;
const EMA_PERIOD = 10;
const BOLLINGER_PERIOD = 20; 
const BOLLINGER_STD_DEV_MULTIPLIER = 2;
// Cache for storing historical prices
const historicalCache: Candle[] = [];
const MAX_CACHE_SIZE = 100;


// Initialize the CCXT exchange
const exchange = new ccxt.binance({
    'enableRateLimit': true,
});


type Candle = {
    timestamp: number;
    close: number;
};


async function fetchPrice(ticker = 'SOL/USDC') {
    const tickerData = await exchange.fetchTicker(ticker);
    const price = parseFloat(tickerData.last?.toString() ?? "");

    if (isNaN(price)) {
        throw new Error("Fetched price is not a valid number.");
    }

    return price;
}



// Function to update the cache with new data
function updateCache(newData: ccxt.OHLCV) {
    historicalCache.push({
        timestamp: newData[0] as number,
        close: newData[4] as number
    });

    // Evict the oldest data if cache exceeds the MAX_CACHE_SIZE
    if (historicalCache.length > MAX_CACHE_SIZE) {
        historicalCache.shift();
    }
}

// Function to watch and update OHLCV data
async function watchMarketData(exchange: ccxt.Exchange, symbol: string, timeframe: string) {
    if (!exchange.has['watchOHLCV']) {
        throw new Error('watchOHLCV not supported for this exchange');
    }

    while (true) {
        try {
            const candles = await exchange.watchOHLCV(symbol, timeframe);
            for (const candle of candles) {
                updateCache(candle);
            }
        } catch (error) {
            console.error('Error in watchMarketData:', error);
        }
    }
}


async function loop() {
    const connection = getConnection();
    const marketAddress = getMarketAddress();
    const traderKeyPair = getTraderKeyPair();
    const marketPubKey = new PublicKey(marketAddress);
    const marketState = await getMarketState(connection, marketAddress);
    const client = await phoenixSdk.Client.create(connection);
    const orderManager = new OrderManager(connection, client, marketPubKey, traderKeyPair);

    while (true) {
        try {
            watchMarketData(exchange, 'SOL/USDC', '1m');
            // Fetch the latest price and calculate technical indicators
            const price = await fetchPrice(); 
            const historicalPrices = historicalCache.map(candle => candle.close);
            const ema = calculateEMA(historicalPrices, EMA_PERIOD);
            const bollingerBands = calculateBands(historicalPrices, BOLLINGER_PERIOD, BOLLINGER_STD_DEV_MULTIPLIER);


            // Calculate bid and ask prices based on EMA and Bollinger Bands
            const bidPrice = adjustPrice(price?? - EDGE, ema[ema.length - 1], bollingerBands, true);
            const askPrice = adjustPrice(price?? + EDGE, ema[ema.length - 1], bollingerBands, false);

            // Calculate volatility and adjust order size accordingly
            const volatility = calculateVolatility(historicalPrices);
            const orderSize = tweakSize(volatility);

            // Submit bid and ask orders
            await orderManager.createAndSubmitOrder({
                type: OrderType.Limit,
                side: phoenixSdk.Side.Bid,
                price: bidPrice,
                size: orderSize,
            });
            await orderManager.createAndSubmitOrder({
                type: OrderType.Limit,
                side: phoenixSdk.Side.Ask,
                price: askPrice,
                size: orderSize,
            });


            await orderManager.tp(price, bollingerBands.upperBand[bollingerBands.upperBand.length - 1]);
            await orderManager.adjustInventory(price, bollingerBands.lowerBand[bollingerBands.lowerBand.length - 1]);

            console.log(`Market Making: Bid @ ${bidPrice}, Ask @ ${askPrice}, Size: ${orderSize}`);
        } catch (error) {
            console.error('Market making loop error:', error);
        }

        await new Promise(resolve => setTimeout(resolve, REFRESH_INTERVAL));
    }
}

function adjustPrice(price: number, ema: number, bollingerBands: { upperBand: number[], lowerBand: number[] }, isBid: boolean): number {
    const currentBollingerUpper = bollingerBands.upperBand[bollingerBands.upperBand.length - 1];
    const currentBollingerLower = bollingerBands.lowerBand[bollingerBands.lowerBand.length - 1];

    if (price > currentBollingerUpper) {
        // Overbought condition
        return isBid ? price : price - EDGE; // Lower ask price, keep bid price
    } else if (price < currentBollingerLower) {
        // Oversold condition
        return isBid ? price + EDGE : price; // Increase bid price, keep ask price
    } else if (price > ema) {
        // Price is above EMA, the market might be bullish
        return isBid ? price + EDGE * 0.5 : price - EDGE * 0.5; // Slightly adjust prices
    } else if (price < ema) {
        // Price is below EMA, the market might be bearish
        return isBid ? price + EDGE * 0.5 : price - EDGE * 0.5; // Slightly adjust prices
    } else {
        return price; // Keep the original price
    }
}

function calculateVolatility(prices: number[]): number {
    // Calculate volatility using standard deviation
    const stdDev = stddev(prices, prices.length);
    const volatility = stdDev[stdDev.length - 1];
    return volatility;
}

function tweakSize(volatility: number): number {
    // Tweak order size based on volatility
    const orderSize = 1 / volatility;
    return orderSize;
}
// Start the market making loop
loop();
