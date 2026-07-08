import { Collection, CollectionInfo, Db, Document, MongoClient } from 'mongodb';
import { ILogger } from 'common-types-lib';
import { IPalFxRateDto } from 'pal-public-types-lib';
import { IPalFxRepository } from 'pal-domain-lib';

const DB_NAME = 'pal';
const COLLECTION_NAME: string = 'fxrates';
const TIMEOUT_MS: number = 5_000;

export class MongoDbFxRepo implements IPalFxRepository {
  private _logger: ILogger;
  private readonly _connectionString: string;
  private _client!: MongoClient;
  private _collection!: Collection<IPalFxRateDto>;

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

  private _docToDto(doc: Document): IPalFxRateDto {
    return {
      id: doc.id,
      sourceAssetCode: doc.sourceAssetCode,
      destinationAssetCode: doc.destinationAssetCode,
      rateType: doc.rateType,
      acquisitionMethod: doc.acquisitionMethod,
      rate: doc.rate,
      peerId: doc.peerId,
      fetchedAt: doc.fetchedAt,
      expiresAt: doc.expiresAt
    };
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
        this._collection = db.collection<IPalFxRateDto>(COLLECTION_NAME);
      } else {
        this._collection =
          await db.createCollection<IPalFxRateDto>(COLLECTION_NAME);
        await this._collection.createIndex({ id: 1 }, { unique: true });
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

  async store(dto: IPalFxRateDto): Promise<void> {
    this._checkInitialisedOrThrow();

    try {
      await this._collection.updateOne(
        { id: dto.id },
        { $set: dto },
        { upsert: true }
      );
      return;
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store fx rate - error: ${(e as Error).message}`
      );
    }
  }

  async fetch(ids: string[]): Promise<IPalFxRateDto[]> {
    this._checkInitialisedOrThrow();

    try {
      const docs = await this._collection.find({ id: { $in: ids } }).toArray();

      if (!docs || docs.length === 0) {
        return [];
      }

      return docs.map(this._docToDto);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to get fx rate by id - error: ${(e as Error).message}`
      );
    }
  }
}
