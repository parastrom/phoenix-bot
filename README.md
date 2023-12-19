# Phoenix Trading Bot

## Overview

Small mm bot for trading the PhoenixTrade dex.  Via SDK and web3.js library for order management, and ccxt for accessing real-time and historical market data.

## Key Features

- **Order Management System (OMS)**: Manages the lifecycle of market orders including creation, submission, cancellation, and status tracking.
- **Market Data Analysis**: Fetches real-time and historical data from Binance using the ccxt library.
- **Technical Analysis Indicators**: Implements some indicators like EMA and BBands for market analysis.
- **Simple Order Sizing**: Adjusts order size using market volatility.
- **Inventory Management**: Manages trader inventory.

## TODO

- **Bundle transactions** - compute fees +  slight obfuscation of intent + needed for multistep instructions.
- **Targeted Order Cancellation** - better order cancelling
- **Instruction support** Better support for instructions available from the sdk

## Setup and Installation

1. **Clone the Repository**:

   ```sh
   git clone https://github.com/parastrom/phoenix-bot.git
   cd phoenix-bot
   ```

2. **Install Depedencies**:

    ```sh
    npm install
    ```

3. Environment Configuration:
Create a .env file with necessary configurations including PRIVATE_KEY and RPC_URL (*If mainnet then the mainnet pool + info will need to be added*)

## Usage

Execute the bot using the command

```sh
npm start
```
