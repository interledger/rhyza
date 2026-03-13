import { Collection, CollectionInfo, Db, MongoClient } from 'mongodb';
import { IPaymentIntent, IPaymentIntentRepository } from 'payments-domain-lib';

const DB_NAME = 'payments';
const COLLECTION_NAME = 'paymentIntents';
const TIMEOUT_MS = 5_000;

export class MongoDbPaymentIntentRepo implements IPaymentIntentRepository {
  private readonly _connectionString: string;
  private _client!: MongoClient;
  private _collection!: Collection<IPaymentIntent>;

  constructor(connectionString: string) {
    this._connectionString = connectionString;
  }

  private _checkInitialisedOrThrow(): boolean {
    if (!this._client || !this._collection) {
      throw new Error('MongoClient not initialised');
    }
    return true;
  }

  async init(): Promise<void> {
    console.info(`Initializing ${this.constructor.name}...`);
    try {
      this._client = new MongoClient(this._connectionString, {
        timeoutMS: TIMEOUT_MS
      });
      await this._client.connect();
      const db: Db = this._client.db(DB_NAME);

      // Check if the collection already exists.
      const collections: (
        | Pick<CollectionInfo, 'name' | 'type'>
        | CollectionInfo
      )[] = await db.listCollections().toArray();
      const collectionExists = collections.some(
        (collection) => collection.name === COLLECTION_NAME
      );

      // load or create the collection (and add its indexes) - should check version and perform migrations
      if (collectionExists) {
        this._collection = db.collection<IPaymentIntent>(COLLECTION_NAME);
      } else {
        this._collection =
          await db.createCollection<IPaymentIntent>(COLLECTION_NAME);
        await this._collection.createIndex({ id: 1 }, { unique: true });
      }
    } catch (e: unknown) {
      if (e instanceof Error) {
        console.error(e);
        throw e;
      }
      const error = new Error(
        "Unable to connect to the database: 'unknown error'"
      );
      console.error(error);
      throw error;
    }

    console.info(`${this.constructor.name} initialized`);
  }

  async destroy(): Promise<void> {
    this._checkInitialisedOrThrow();
    await this._client.close();
  }

  async storeMany(payments: IPaymentIntent[]): Promise<void> {
    this._checkInitialisedOrThrow();

    if (payments.length === 0) return;

    try {
      await this._collection.insertMany(payments);
    } catch (e) {
      console.error(e);
      throw new Error(
        `Unable to store payment intents - error: ${(e as Error).message}`
      );
    }
  }

  async fetchByIds(ids: string[]): Promise<IPaymentIntent[]> {
    this._checkInitialisedOrThrow();

    if (ids.length === 0) return [];

    try {
      const docs = await this._collection.find({ id: { $in: ids } }).toArray();

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
        receivedAmount: doc.receivedAmount
      }));
    } catch (e) {
      console.error(e);
      throw new Error(
        `Unable to fetch payment intents - error: ${(e as Error).message}`
      );
    }
  }
}
