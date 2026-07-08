import { IPalWalletAddressDto } from 'pal-public-types-lib';
import { Collection, CollectionInfo, Db, MongoClient } from 'mongodb';
import { IPalWalletAddressRepository } from 'pal-domain-lib';
import { ILogger } from 'common-types-lib';

const DB_NAME = 'pal';
const COLLECTION_NAME: string = 'walletAddresses';
const TIMEOUT_MS: number = 5_000;

export class MongoDbWalletRepo implements IPalWalletAddressRepository {
  private _logger: ILogger;
  private readonly _connectionString: string;
  private _client!: MongoClient;
  private _collection!: Collection<IPalWalletAddressDto>;

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
        this._collection = db.collection<IPalWalletAddressDto>(COLLECTION_NAME);
      } else {
        this._collection =
          await db.createCollection<IPalWalletAddressDto>(COLLECTION_NAME);
        await this._collection.createIndex({ id: 1 }, { unique: true });
        await this._collection.createIndex({
          'aliases.domain': 1,
          'aliases.pathName': 1
        });
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

  async store(walletAddress: IPalWalletAddressDto): Promise<void> {
    this._checkInitialisedOrThrow();

    try {
      await this._collection.updateOne(
        { id: walletAddress.id },
        { $set: walletAddress },
        { upsert: true }
      );
      return;
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store wallet address - error: ${(e as Error).message}`
      );
    }
  }

  async fetch(ids: string[]): Promise<IPalWalletAddressDto[]> {
    this._checkInitialisedOrThrow();

    try {
      const docs = await this._collection.find({ id: { $in: ids } }).toArray();

      if (!docs || docs.length === 0) {
        return [];
      }

      return docs.map((doc) => {
        return {
          id: doc.id,
          publicName: doc.publicName,
          isActive: doc.isActive,
          assetCode: doc.assetCode,
          assetScale: doc.assetScale,
          aliases: doc.aliases
        };
      });
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to get wallet by address - error: ${(e as Error).message}`
      );
    }
  }

  async getByAlias(
    domain: string | null,
    pathName: string
  ): Promise<IPalWalletAddressDto | null> {
    this._checkInitialisedOrThrow();

    try {
      const doc = await this._collection.findOne({
        aliases: { $elemMatch: { domain: domain, pathName: pathName } }
      });

      if (!doc) {
        return null;
      }

      return {
        id: doc.id,
        publicName: doc.publicName,
        isActive: doc.isActive,
        assetCode: doc.assetCode,
        assetScale: doc.assetScale,
        aliases: doc.aliases
      };
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to get wallet by address - error: ${(e as Error).message}`
      );
    }
  }
}
