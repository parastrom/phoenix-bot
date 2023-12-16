import * as phoenixSdk from "@ellipsis-labs/phoenix-sdk";
import {ticksToPrice} from "./marketUtils";

export function calculateEMA(prices: number[], period: number): number[] {
    let ema: number[] = [];
    let k = 2/(period + 1);

    // Start with the first data point as initial SMA
    ema[0] = prices[0];

    // Calculate the rest of the EMA values
    for (let i = 1; i < prices.length; i++) {
        ema[i] = prices[i] * k + ema[i - 1] * (1 - k);
    }

    return ema;
}

// Calculate Simple Moving Average
export function calculateSMA(prices: number[], period: number): number {
    if (prices.length < period) {
        throw new Error("Not enough data to calculate SMA");
    }

    const sum = prices.slice(-period).reduce((acc, price) => acc + price, 0);
    return sum / period;
}


// Bollinger Bands
export function calculateBands(prices: number[], period: number, stdDevMultiplier: number = 2) {

    let stdDevs = stddev(prices, period);
    let bands = prices.reduce<{ upperBand: number[], lowerBand: number[], smaValues: number[] }>((acc, _, index) => {
        if (index < period - 1) return acc; // Not enough data yet

        let slice = prices.slice(index - period + 1, index + 1);
        let sma = calculateSMA(slice, period);
        let stdDev = stdDevs[index]; // Use the correct stdDev value for this slice

        acc.upperBand.push(sma + stdDev * stdDevMultiplier);
        acc.lowerBand.push(sma - stdDev * stdDevMultiplier);
        acc.smaValues.push(sma);

        return acc;
    }, { upperBand: [], lowerBand: [], smaValues: [] });

    return bands;
}

export function stddev(prices: number[], period: number): number[] {
    let stdDev: number[] = [];
    for (let i = 0; i < prices.length; i++) {
        let slice = prices.slice(Math.max(i - period + 1, 0), i + 1);
        let mean = slice.reduce((a, b) => a + b, 0) / slice.length;
        let sum = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0);
        stdDev[i] = Math.sqrt(sum / slice.length);
    }
    return stdDev;
}





function calculateSpread(marketData: phoenixSdk.L3Book): number {
    let highestBid = marketData.bids[0].priceInTicks;;
    let lowestAsk = marketData.asks[0].priceInTicks;
    return ticksToPrice(highestBid) - ticksToPrice(lowestAsk);
}

function calculateBBAImbalance(marketData: phoenixSdk.MarketData): number {
    let totalBidQuantity = marketData.bids.reduce((total, [_, order]) => total + phoenixSdk.toNum(order.numBaseLots), 0);
    let totalAskQuantity = marketData.asks.reduce((total, [_, order]) => total + phoenixSdk.toNum(order.numBaseLots), 0);
    return totalBidQuantity - totalAskQuantity;
}
