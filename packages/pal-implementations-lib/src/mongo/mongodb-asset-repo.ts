import { Collection, CollectionInfo, Db, MongoClient } from 'mongodb';
import { IPalAssetRepository } from 'pal-domain-lib';
import { IPalAssetDto } from 'pal-public-types-lib';
import { ILogger } from 'common-types-lib';

const DB_NAME = 'pal';
const COLLECTION_NAME: string = 'assets';
const TIMEOUT_MS: number = 5_000;

export class MongoDbAssetRepo implements IPalAssetRepository {
  private readonly _logger: ILogger;
  private readonly _connectionString: string;
  private _client!: MongoClient;
  private _collection!: Collection<IPalAssetDto>;

  constructor(connectionString: string, logger: ILogger) {
    this._connectionString = connectionString;
    this._logger = logger;
  }

  private _checkInitialisedOrThrow(): boolean {
    if (!this._client || !this._collection) {
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

      // Check if the collection already exists.
      const collections: (
        | Pick<CollectionInfo, 'name' | 'type'>
        | CollectionInfo
      )[] = await db.listCollections().toArray();
      const collectionExists: boolean = collections.some((collection) => {
        return collection.name === COLLECTION_NAME;
      });

      // load or create the collection (and add its indexes) - should check version and perform migrations
      if (collectionExists) {
        this._collection = db.collection<IPalAssetDto>(COLLECTION_NAME);
      } else {
        this._collection =
          await db.createCollection<IPalAssetDto>(COLLECTION_NAME);
        await this._collection.createIndex({ code: 1 }, { unique: true });
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

  async store(asset: IPalAssetDto): Promise<void> {
    this._checkInitialisedOrThrow();

    try {
      await this._collection.updateOne(
        { code: asset.code },
        { $set: asset },
        { upsert: true }
      );
      return;
    } catch (e) {
      this._logger.error(e);
      throw new Error(`Unable to store asset - error: ${(e as Error).message}`);
    }
  }

  async fetch(code: string): Promise<IPalAssetDto | null> {
    this._checkInitialisedOrThrow();

    try {
      const doc = await this._collection.findOne({ code: code });
      if (!doc) {
        return null;
      }
      return {
        code: doc.code,
        scale: doc.scale,
        ledgerAccountId: doc.ledgerAccountId || null
      };
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to get asset by code - error: ${(e as Error).message}`
      );
    }
  }
}
