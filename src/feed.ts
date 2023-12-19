import {
    Connection,
    PublicKey,
    ConfirmedSignatureInfo,
} from "@solana/web3.js"
import * as phoenixSdk from "@ellipsis-labs/phoenix-sdk"
import * as beet from "@metaplex-foundation/beet"

const MARKET_ADDRESS = "CS2H8nbAVVEUHWPF5extCSymqheQdkd4d7thik6eet9N"
const POLLING = 200;


class Subscriber {
    constructor(
        private connection: Connection,
        private marketAddress: PublicKey,
    ) {}

    async subscribe() {
        let lastSignature: string | undefined = undefined;

        while (true) {
            const signatures = await this.connection.getConfirmedSignaturesForAddress2(
                this.marketAddress,
                {
                    limit: 10,
                    before: lastSignature,
                }
            );

            if (signatures.length > 0) {
                const signature = signatures[0];
                if (signature.signature !== lastSignature) {
                    lastSignature = signature.signature;
                    console.log("New signature", signature);
                }
            }
            
            lastSignature = signatures.length > 0 ? signatures[signatures.length - 1].signature : lastSignature;
            const  unixTimestamp: beet.bignum = Math.floor(Date.now() / 1000);
            const state = await phoenixSdk.MarketState.loadFromAddress({
                connection: this.connection,
                address: this.marketAddress,    
            });
            const slot = await this.connection.getSlot();
            const book = phoenixSdk.getMarketL3Book(state.data, 5, unixTimestamp, 100);
            

            await sleep(POLLING);
        }
    }

    async getNewTransactions(beforeSignature: string | undefined): Promise<ConfirmedSignatureInfo[]> {
        const options = {
          limit: 10, // dependent on depe
          before: beforeSignature,
        };
        return this.connection.getSignaturesForAddress(this.marketAddress, options);
    }
    
    async parseEventsFromTransactions(transactions: ConfirmedSignatureInfo[]) {
        for (const transaction of transactions) {
            const decodedTransaction = await phoenixSdk.getPhoenixEventsFromTransactionSignature(
                this.connection,
                transaction.signature
            );
            for (const instruction of decodedTransaction.instructions) {
                this.handleEvent(instruction.events);
            }
        }
    }

    handleEvent(event: phoenixSdk.PhoenixMarketEvent[]) {
        for (const e of event) {
            console.log(e);
        }
    }

}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));