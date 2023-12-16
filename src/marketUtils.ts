import * as beet from "@metaplex-foundation/beet"
import * as phoenixSdk  from "@ellipsis-labs/phoenix-sdk";
import { Connection, PublicKey, Keypair } from '@solana/web3.js';


interface TokenConfig {
    address: string;
    decimals: number;
    name: string;
    symbol: string;
    mint: string;
}

interface MarketConfig {
    address: string;
    base_ticker: string;
    quote_ticker: string;
    base_pubkey: string;
    quote_pubkey: string;
    base_lot_size_units: number;
    quote_lot_size_units: number;
    tick_size: number;
    tokens: { [key: string]: TokenConfig };
}


const config: MarketConfig = require("./pools/dev_SOL_USDC.json");

const BASE_DECIMALS = config.tokens[config.base_pubkey].decimals;
const QUOTE_DECIMALS = config.tokens[config.quote_pubkey].decimals;
const BASE_LOT_SIZE_UNITS = config.base_lot_size_units;
const QUOTE_LOT_SIZE_UNITS = config.quote_lot_size_units;
const TICK_SIZE = config.tick_size;

export const getConnection = () => new Connection(process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com');

export const getMarketAddress = () => new PublicKey(config.address);

export const getTraderKeyPair = () => {
    if (!process.env.PRIVATE_KEY) {
        throw new Error("PRIVATE_KEY is not defined");
    }

    let privKeyArray;
    try {
        privKeyArray = JSON.parse(process.env.PRIVATE_KEY);
    } catch (err) {
        throw new Error("PRIVATE_KEY is not a valid JSON array");
    }

    return Keypair.fromSecretKey(new Uint8Array(privKeyArray));
};

export const getRPC = () => process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';

export const getMarketState = async (connection: Connection, marketAddress: PublicKey) => {
    const marketState = await phoenixSdk.MarketState.loadFromAddress({
        connection,
        address: marketAddress,
    });

    return marketState;
}

export function lotsToBaseUnits(baseLots: beet.bignum): number {
    return phoenixSdk.toNum(baseLots) * Math.pow(10, BASE_DECIMALS) * BASE_LOT_SIZE_UNITS;
}

// Convert ticks to price using the formula: Price = Ticks * Tick Size / Quote Lot Size Units
export function ticksToPrice(ticks: beet.bignum): number {
    return phoenixSdk.toNum(ticks) * TICK_SIZE / QUOTE_LOT_SIZE_UNITS;
}

// Function to convert base lots to the actual size in SOL units
export function convertBaseLotsToSize(baseLots: number): number {
    return baseLots * BASE_LOT_SIZE_UNITS;
}