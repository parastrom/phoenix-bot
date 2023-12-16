/** @format */

import {
	Keypair,
	Connection,
	PublicKey,
	Transaction,
	sendAndConfirmTransaction,
	ConfirmedSignatureInfo,
} from "@solana/web3.js";

import BigNum from "bn.js";
import * as phoenixSdk from "@ellipsis-labs/phoenix-sdk";
import { lotsToBaseUnits, ticksToPrice } from "./marketUtils";
import * as beet from "@metaplex-foundation/beet";

export enum OrderType {
	Limit,
	Market,
}

export enum OrderStatus {
	Created,
	Submitted,
	Filled,
	PartiallyFilled,
	Cancelled,
	Expired,
}

export interface Order {
	id: number;
	type: OrderType;
	side: phoenixSdk.Side;
	price: number;
	size: number;
	status: OrderStatus;
	sizeFilled?: number;
	executionPrice?: number;
}

export class OrderManager {
	private _connection: Connection;
	private _client: phoenixSdk.Client;
	private _marketPubKey: PublicKey;
	private _traderKeyPair: Keypair;
	private orders: Map<number, Order>;
	private static lastOrderId: number = 0;

    MAX_THRESHOLD = 10;
    MIN_THRESHOLD = 1;
    inventory = 0;

	constructor(
		connection: Connection,
		client: phoenixSdk.Client,
		marketPubKey: PublicKey,
		traderKeyPair: Keypair
	) {
		this._connection = connection;
		this._client = client;
		this._marketPubKey = marketPubKey;
		this._traderKeyPair = traderKeyPair;
		this.orders = new Map<number, Order>();
	}

	async setupMaker(marketState: phoenixSdk.MarketState): Promise<void> {
		const setupNewMakerIxs = await phoenixSdk.getMakerSetupInstructionsForMarket(
			this._connection,
			marketState,
			this._traderKeyPair.publicKey
		);

		if (setupNewMakerIxs.length !== 0) {
			const setup = new Transaction().add(...setupNewMakerIxs);
			const setupTxId = await sendAndConfirmTransaction(
				this._connection,
				setup,
				[this._traderKeyPair],
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

	async createAndSubmitOrder(
		orderDetails: Omit<Order, "id" | "status">
	): Promise<void> {
		const order = {
			...orderDetails,
			id: this.generateOrderId(),
			status: OrderStatus.Created,
		};

		if (!this.validateOrder(order)) {
			throw new Error("Order Validation Failed");
		}

		this.orders.set(order.id, order);

		const orderTemplate = this.createOrderTemplate(order);
		const instruction = this._client.getLimitOrderInstructionfromTemplate(
			this._marketPubKey.toBase58(),
			this._traderKeyPair.publicKey,
			orderTemplate
		);

		const transaction = new Transaction().add(instruction);
		const txId = await sendAndConfirmTransaction(
			this._connection,
			transaction,
			[this._traderKeyPair],
			{
				skipPreflight: true,
				commitment: "confirmed",
			}
		);

		order.status = OrderStatus.Submitted;
		this.orders.set(order.id, order);

		console.log(`Order placed. Tx Link: https://beta.solscan.io/tx/${txId}`);
	}

	async cancelAllOrders(): Promise<void> {
		const cancelAll = this._client.createCancelAllOrdersInstruction(
			this._marketPubKey.toString(),
			this._traderKeyPair.publicKey
		);

		try {
			const cancelTransaction = new Transaction().add(cancelAll);
			const txid = await sendAndConfirmTransaction(
				this._connection,
				cancelTransaction,
				[this._traderKeyPair],
				{
					skipPreflight: false,
					commitment: "confirmed",
				}
			);

			this.orders.forEach((order) => {
				order.status = OrderStatus.Cancelled;
				this.orders.set(order.id, order);
			});

			console.log(`Cancel Tx Link: https://beta.solscan.io/tx/${txid}`);
		} catch (err) {
			console.error(err);
			return;
		}
	}

	private validateOrder(order: Order): boolean {
		// TODO Validate order
		return true;
	}

	private generateOrderId(): number {
		return ++OrderManager.lastOrderId;
	}

	private getOrderStatus(orderId: number): OrderStatus {
		const order = this.orders.get(orderId);
		if (!order) {
			throw new Error("Order not found");
		}
		return order.status;
	}

	private createOrderTemplate(order: Order): phoenixSdk.LimitOrderTemplate {
		const currentTime = Math.floor(Date.now() / 1000);
		const orderLifetime = 60;

		return {
			side: order.side,
			priceAsFloat: order.price,
			sizeInBaseUnits: order.size,
			selfTradeBehavior: phoenixSdk.SelfTradeBehavior.Abort,
			clientOrderId: order.id, // Generate unique ID as needed
			useOnlyDepositedFunds: false,
			lastValidSlot: undefined,
			lastValidUnixTimestampInSeconds: currentTime + orderLifetime,
		};
	}

	processDecodedTransaction(decodedTransaction: phoenixSdk.PhoenixTransaction) {
		for (const instruction of decodedTransaction.instructions) {
			this.processInstructionEvents(instruction.events);
		}
	}

	private processInstructionEvents(events: phoenixSdk.PhoenixMarketEvent[]) {
		for (const event of events) {
			if (event.__kind === "FillSummary") {
				const fields = event.fields[0];
				const clientOrderId = event.fields[0].clientOrderId;
				const localOrder = this.orders.get(phoenixSdk.toNum(clientOrderId));

				if (localOrder) {
					this.updateLocalOrder(localOrder, fields);
				}
			}
		}
	}

	private updateLocalOrder(localOrder: Order, fields: phoenixSdk.FillSummaryEvent) {
		const baseLotsFilled = fields.totalBaseLotsFilled;
		const baseUnitsFilled = lotsToBaseUnits(baseLotsFilled);
		const isFullFill = baseUnitsFilled === localOrder.size;
		localOrder.status = isFullFill ? OrderStatus.Filled : OrderStatus.PartiallyFilled;
		localOrder.sizeFilled = baseUnitsFilled;

		if (
			localOrder.status === OrderStatus.Filled ||
			localOrder.status === OrderStatus.PartiallyFilled
		) {
			const quoteLotsFilled = new BigNum(fields.totalQuoteLotsFilled.toString(10));
			const executionPrice = ticksToPrice(quoteLotsFilled);
			localOrder.executionPrice = executionPrice;

            this.updateInventory(localOrder.side, baseUnitsFilled);
		}

		this.orders.set(localOrder.id, localOrder);
	}

    async tp(currentPrice: number, upperBand: number) {
        if (currentPrice > upperBand) {
            console.log("TP");
            const sellSize = this.calculateSellSize();
            await this.createAndSubmitOrder({
                type: OrderType.Limit,
                side: phoenixSdk.Side.Ask,
                price: currentPrice,
                size: sellSize,
            });
            this.inventory = 0;
            console.log(`Taking profit: Selling ${sellSize} SOL at ${currentPrice}`);
        }
    }

    async adjustInventory(currentPrice: number, lowerBand: number) {
        if (currentPrice < lowerBand) {
            const buySize = this.calculateBuySize();
            await this.createAndSubmitOrder({
                type: OrderType.Limit,
                side: phoenixSdk.Side.Bid,
                price: currentPrice,
                size: buySize,
            });
            console.log(`Adjusting inventory: Buying ${buySize} SOL at ${currentPrice}`);
        }
    }


    private updateInventory(side: phoenixSdk.Side, sizeFilled: number) {
        if (side === phoenixSdk.Side.Bid) {
            this.inventory += sizeFilled;
        } else if (side === phoenixSdk.Side.Ask) {
            this.inventory -= sizeFilled;
        }
    }



    private calculateSellSize() {
        return Math.min(this.inventory / 2, this.MAX_THRESHOLD - this.inventory);
    }

    private calculateBuySize() {
        return Math.min((this.MAX_THRESHOLD - this.inventory) / 2, this.MAX_THRESHOLD - this.inventory);
    }
}

class TransactionMonitor {
	private connection: Connection;
	private traderPublicKey: PublicKey;
	private lastSignature: string | undefined;

	constructor(
		private orderManager: OrderManager,
		connection: Connection,
		traderPubKey: PublicKey
	) {
		this.connection = connection;
		this.traderPublicKey = traderPubKey;
		this.lastSignature = undefined;
	}

	async monitorTransactions() {
		while (true) {
			const signatures = await this.fetchNewTransactions();

			for (const sign of signatures) {
				const decodedTransaction =
					await phoenixSdk.getPhoenixEventsFromTransactionSignature(
						this.connection,
						sign.signature
					);
				this.orderManager.processDecodedTransaction(decodedTransaction);
			}
			await new Promise((resolve) => setTimeout(resolve, 3000));
		}
	}

	async fetchNewTransactions(): Promise<ConfirmedSignatureInfo[]> {
		const signatures = await this.connection.getConfirmedSignaturesForAddress2(
			this.traderPublicKey,
			{
				limit: 10,
				before: this.lastSignature,
			}
		);

		if (signatures.length > 0) {
			this.lastSignature = signatures[signatures.length - 1].signature;
		}

		return signatures;
	}
}
