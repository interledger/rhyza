import { Collection, CollectionInfo, Db, MongoClient } from 'mongodb';
import {
  FinalizedRemoteQuoteUpdate,
  IPayment,
  IPaymentIntent,
  IPaymentIntentRepository,
  PaymentIntentState,
  PaymentState
} from 'payments-domain-lib';
import { ILogger } from 'common-types-lib';

const DB_NAME = 'payments';
const PAYMENT_INTENTS_COLLECTION_NAME = 'paymentIntents';
const PAYMENTS_COLLECTION_NAME = 'payments';
const TIMEOUT_MS = 5_000;

export class MongoDbPaymentIntentRepo implements IPaymentIntentRepository {
  private readonly _connectionString: string;
  private readonly _logger: ILogger;
  private _client!: MongoClient;
  private _paymentIntentCollection!: Collection<
    Omit<IPaymentIntent, 'payments'>
  >;
  private _paymentCollection!: Collection<IPayment>;

  constructor(connectionString: string, logger: ILogger) {
    this._connectionString = connectionString;
    this._logger = logger;
  }

  private _checkInitialisedOrThrow(): boolean {
    if (!this._client || !this._paymentIntentCollection) {
      throw new Error('MongoClient not initialised');
    }
    return true;
  }

  async init(): Promise<void> {
    this._logger.info(`Initializing ${this.constructor.name}...`);
    try {
      this._client = new MongoClient(this._connectionString, {
        timeoutMS: TIMEOUT_MS
      });
      await this._client.connect();
      const db: Db = this._client.db(DB_NAME);

      // Check if the collections already exist.
      const collections: (
        | Pick<CollectionInfo, 'name' | 'type'>
        | CollectionInfo
      )[] = await db.listCollections().toArray();

      const paymentIntentsCollectionExists = collections.some(
        (collection) => collection.name === PAYMENT_INTENTS_COLLECTION_NAME
      );

      // load or create the collection (and add its indexes) - should check version and perform migrations
      if (paymentIntentsCollectionExists) {
        this._paymentIntentCollection = db.collection(
          PAYMENT_INTENTS_COLLECTION_NAME
        );
      } else {
        this._paymentIntentCollection = await db.createCollection(
          PAYMENT_INTENTS_COLLECTION_NAME
        );
        await this._paymentIntentCollection.createIndex(
          { id: 1 },
          { unique: true }
        );
        await this._paymentIntentCollection.createIndex(
          { remoteUrl: 1 },
          { unique: true, sparse: true }
        );
      }

      const paymentsCollectionExists = collections.some(
        (collection) => collection.name === PAYMENTS_COLLECTION_NAME
      );
      // load or create the collection (and add its indexes) - should check version and perform migrations
      if (paymentsCollectionExists) {
        this._paymentCollection = db.collection<IPayment>(
          PAYMENTS_COLLECTION_NAME
        );
      } else {
        this._paymentCollection = await db.createCollection<IPayment>(
          PAYMENTS_COLLECTION_NAME
        );
        await this._paymentCollection.createIndex({ id: 1 }, { unique: true });
      }
    } catch (e: unknown) {
      if (e instanceof Error) {
        this._logger.error(e);
        throw e;
      }
      const error = new Error(
        "Unable to connect to the database: 'unknown error'"
      );
      this._logger.error(error);
      throw error;
    }

    this._logger.info(`${this.constructor.name} initialized`);
  }

  async destroy(): Promise<void> {
    this._checkInitialisedOrThrow();
    await this._client.close();
  }

  async storeMany(payments: IPaymentIntent[]): Promise<void> {
    this._checkInitialisedOrThrow();

    if (payments.length === 0) return;

    try {
      await this._paymentIntentCollection.insertMany(
        payments.map((p) => {
          const doc: Omit<IPaymentIntent, 'payments'> = {
            id: p.id,
            receiverWalletAddressId: p.receiverWalletAddressId,
            receiverWalletAddress: p.receiverWalletAddress,
            state: p.state,
            destination: p.destination,
            assetCode: p.assetCode,
            assetScale: p.assetScale,
            expiresAt: p.expiresAt,
            incomingAmount: p.incomingAmount,
            receivedAmount: p.receivedAmount,
            destinationIlpAddress: p.destinationIlpAddress,
            quotes: p.quotes
          };
          if (p.remoteUrl != null) doc.remoteUrl = p.remoteUrl;
          return doc;
        })
      );
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store payment intents - error: ${(e as Error).message}`
      );
    }
  }

  async fetchByIds(ids: string[]): Promise<Omit<IPaymentIntent, 'payments'>[]> {
    this._checkInitialisedOrThrow();

    if (ids.length === 0) return [];

    try {
      const docs = await this._paymentIntentCollection
        .find({ id: { $in: ids } })
        .toArray();

      return docs.map((doc) => ({
        id: doc.id,
        receiverWalletAddressId: doc.receiverWalletAddressId,
        receiverWalletAddress: doc.receiverWalletAddress,
        state: doc.state,
        destination: doc.destination,
        assetCode: doc.assetCode,
        assetScale: doc.assetScale,
        expiresAt: doc.expiresAt,
        incomingAmount: doc.incomingAmount,
        receivedAmount: doc.receivedAmount,
        destinationIlpAddress: doc.destinationIlpAddress,
        remoteUrl: doc.remoteUrl,
        quotes: doc.quotes.map((quote) => ({
          id: quote.id,
          senderWalletAddress: quote.senderWalletAddress,
          senderWalletAddressId: quote.senderWalletAddressId,
          ...(quote.state === 'COMPLETED'
            ? {
                state: quote.state,
                debitAmount: quote.debitAmount,
                receiveAmount: quote.receiveAmount,
                expiresAt: quote.expiresAt,
                exchangeRate: quote.exchangeRate
              }
            : quote.state === 'FAILED'
              ? {
                  state: quote.state,
                  errorName: quote.errorName,
                  message: quote.message
                }
              : { state: quote.state })
        }))
      }));
    } catch (err) {
      this._logger.error(err);
      throw new Error(
        `Unable to fetch payment intents - error: ${(err as Error).message}`
      );
    }
  }

  async fetchByIdsWithPayments(ids: string[]): Promise<IPaymentIntent[]> {
    this._checkInitialisedOrThrow();

    if (ids.length === 0) return [];

    try {
      const [paymentIntentDocs, paymentDocs] = await Promise.all([
        this._paymentIntentCollection.find({ id: { $in: ids } }).toArray(),
        this._paymentCollection
          .find({ paymentIntentId: { $in: ids } })
          .toArray()
      ]);

      return paymentIntentDocs.map((doc) => ({
        id: doc.id,
        receiverWalletAddressId: doc.receiverWalletAddressId,
        receiverWalletAddress: doc.receiverWalletAddress,
        state: doc.state,
        destination: doc.destination,
        assetCode: doc.assetCode,
        assetScale: doc.assetScale,
        expiresAt: doc.expiresAt,
        incomingAmount: doc.incomingAmount,
        receivedAmount: doc.receivedAmount,
        destinationIlpAddress: doc.destinationIlpAddress,
        remoteUrl: doc.remoteUrl,
        quotes: doc.quotes.map((quote) => ({
          id: quote.id,
          senderWalletAddress: quote.senderWalletAddress,
          senderWalletAddressId: quote.senderWalletAddressId,
          ...(quote.state === 'COMPLETED'
            ? {
                state: quote.state,
                debitAmount: quote.debitAmount,
                receiveAmount: quote.receiveAmount,
                expiresAt: quote.expiresAt,
                exchangeRate: quote.exchangeRate
              }
            : quote.state === 'FAILED'
              ? {
                  state: quote.state,
                  errorName: quote.errorName,
                  message: quote.message
                }
              : { state: quote.state })
        })),
        payments: paymentDocs
          .filter((p) => p.paymentIntentId === doc.id)
          .map((payment) => ({
            id: payment.id,
            state: payment.state,
            paymentIntentId: payment.paymentIntentId,
            senderWalletAddress: payment.senderWalletAddress,
            senderWalletAddressId: payment.senderWalletAddressId,
            quoteId: payment.quoteId,
            assetCode: payment.assetCode,
            assetScale: payment.assetScale,
            debitAmount: payment.debitAmount,
            receiveAmount: payment.receiveAmount,
            sentAmount: payment.sentAmount
          }))
      }));
    } catch (err) {
      this._logger.error(err);
      throw new Error(
        `Unable to fetch payment intents - error: ${(err as Error).message}`
      );
    }
  }

  async fetchIdsByRemoteUrls(
    urls: string[]
  ): Promise<Array<{ id: string; remoteUrl: string }>> {
    this._checkInitialisedOrThrow();

    if (urls.length === 0) return [];

    try {
      const docs = (await this._paymentIntentCollection
        .find(
          { remoteUrl: { $in: urls } },
          { projection: { _id: 0, id: 1, remoteUrl: 1 } }
        )
        .toArray()) as Array<{ id: string; remoteUrl: string }>;

      return docs;
    } catch (err) {
      this._logger.error(err);
      throw new Error(
        `Unable to fetch payment intent ids by remote URLs - error: ${(err as Error).message}`
      );
    }
  }

  async storeQuotes(
    quoteUpdates: { quoteIds: string[]; paymentIntent: IPaymentIntent }[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (quoteUpdates.length === 0) return;

    try {
      await this._paymentIntentCollection.bulkWrite(
        quoteUpdates.map((update) => ({
          updateOne: {
            filter: { id: update.paymentIntent.id },
            update: {
              $push: {
                quotes: {
                  $each: update.paymentIntent.quotes.filter((q) =>
                    update.quoteIds.includes(q.id)
                  )
                }
              }
            }
          }
        }))
      );
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store quotes for payment intents - error: ${(e as Error).message}`
      );
    }
  }

  async storePayments(
    paymentUpdates: { paymentIds: string[]; paymentIntent: IPaymentIntent }[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (paymentUpdates.length === 0) return;

    const newPaymentEntities: IPayment[] = [];

    for (const update of paymentUpdates) {
      const payments = update.paymentIntent.payments.filter((p) =>
        update.paymentIds.includes(p.id)
      );

      for (const payment of payments) {
        newPaymentEntities.push({
          id: payment.id,
          state: payment.state,
          senderWalletAddress: payment.senderWalletAddress,
          senderWalletAddressId: payment.senderWalletAddressId,
          paymentIntentId: payment.paymentIntentId,
          assetCode: payment.assetCode,
          assetScale: payment.assetScale,
          debitAmount: payment.debitAmount,
          quoteId: payment.quoteId ? payment.quoteId : undefined,
          receiveAmount: payment.receiveAmount,
          sentAmount: payment.sentAmount
        });
      }
    }

    try {
      await this._paymentCollection.insertMany(newPaymentEntities);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store payments - error: ${(e as Error).message}`
      );
    }
  }

  async storeFinalizedRemoteQuotes(
    updates: FinalizedRemoteQuoteUpdate[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (updates.length === 0) return;

    try {
      await this._paymentIntentCollection.bulkWrite(
        updates.map((u) => ({
          updateOne: {
            filter: { id: u.paymentIntentId },
            update: {
              $set:
                u.state === 'COMPLETED'
                  ? {
                      'quotes.$[q].state': 'COMPLETED',
                      'quotes.$[q].debitAmount': u.debitAmount,
                      'quotes.$[q].receiveAmount': u.receiveAmount,
                      'quotes.$[q].exchangeRate': u.exchangeRate,
                      'quotes.$[q].expiresAt': u.expiresAt
                    }
                  : {
                      'quotes.$[q].state': 'FAILED',
                      'quotes.$[q].errorName': u.errorName,
                      'quotes.$[q].message': u.message
                    }
            },
            arrayFilters: [{ 'q.id': u.quoteId }]
          }
        }))
      );
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to finalize remote quotes - error: ${(e as Error).message}`
      );
    }
  }

  async storeCompletedLocalPayments(
    paymentUpdates: {
      paymentIntent: {
        id: string;
        receivedAmount: bigint;
        state: PaymentIntentState;
      };
      payments: { id: string; state: PaymentState; sentAmount: bigint }[];
    }[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (paymentUpdates.length === 0) return;

    try {
      const intentWrites = paymentUpdates.map((update) => ({
        updateOne: {
          filter: { id: update.paymentIntent.id },
          update: {
            $set: {
              state: update.paymentIntent.state,
              receivedAmount: update.paymentIntent.receivedAmount
            }
          }
        }
      }));

      const paymentWrites = paymentUpdates.flatMap((update) =>
        update.payments
          .filter((p) => update.payments.map((p) => p.id).includes(p.id))
          .map((payment) => ({
            updateOne: {
              filter: { id: payment.id },
              update: {
                $set: {
                  state: payment.state,
                  sentAmount: payment.sentAmount
                }
              }
            }
          }))
      );

      await Promise.all([
        this._paymentIntentCollection.bulkWrite(intentWrites),
        this._paymentCollection.bulkWrite(paymentWrites)
      ]);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store payments - error: ${(e as Error).message}`
      );
    }
  }
}
