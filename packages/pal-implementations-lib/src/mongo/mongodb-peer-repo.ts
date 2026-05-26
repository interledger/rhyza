import { Collection, CollectionInfo, Db, Document, MongoClient } from 'mongodb';
import { ILogger } from 'common-types-lib';
import { IPalPeerRepository } from 'pal-domain-lib';
import { IPalPeerDto } from 'pal-public-types-lib';

const DB_NAME = 'pal';
const WALLET_COLLECTION_NAME: string = 'peers';
const TIMEOUT_MS: number = 5_000;

export class MongoDbPeerRepo implements IPalPeerRepository {
  private _logger: ILogger;
  private readonly _connectionString: string;
  private _client!: MongoClient;
  private _collection!: Collection<IPalPeerDto>;

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

  private _docToDto(doc: Document): IPalPeerDto {
    return {
      id: doc.id,
      name: doc.name,
      active: doc.active,
      assetCode: doc.assetCode,
      assetScale: doc.assetScale,
      communicationMethodDefinition: doc.communicationMethodDefinition,
      ledgerAccounts: doc.ledgerAccounts
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
        return collection.name === WALLET_COLLECTION_NAME;
      });

      // load or create the collection (and add its indexes) - should check version and perform migrations
      if (collectionExists) {
        this._collection = db.collection<IPalPeerDto>(WALLET_COLLECTION_NAME);
      } else {
        this._collection = await db.createCollection<IPalPeerDto>(
          WALLET_COLLECTION_NAME
        );
        await this._collection.createIndex({ id: 1 }, { unique: true });
        await this._collection.createIndex({
          'communicationMethod.type': 1,
          'communicationMethod.staticAddress': 1
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

  async store(peerDto: IPalPeerDto): Promise<void> {
    this._checkInitialisedOrThrow();

    try {
      await this._collection.updateOne(
        { id: peerDto.id },
        { $set: peerDto },
        { upsert: true }
      );
      return;
    } catch (e) {
      this._logger.error(e);
      throw new Error(`Unable to store peer - error: ${(e as Error).message}`);
    }
  }

  async fetch(ids: string[]): Promise<IPalPeerDto[]> {
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
        `Unable to get peer by id - error: ${(e as Error).message}`
      );
    }
  }

  async fetchByCommsMethodAndAddress(
    commType: 'ILP',
    staticAddress: string
  ): Promise<IPalPeerDto | null> {
    this._checkInitialisedOrThrow();

    try {
      const doc = await this._collection.findOne({
        $and: [
          {
            'communicationMethodDefinition.type': {
              $regex: new RegExp(`^${commType}$`, 'i')
            }
          },
          {
            'communicationMethodDefinition.staticAddress': {
              $regex: new RegExp(`^${staticAddress}$`, 'i')
            }
          }
        ]
      });

      if (!doc) {
        return null;
      }

      return this._docToDto(doc);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to get peer by communication method and address - error: ${(e as Error).message}`
      );
    }
  }
}
