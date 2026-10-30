import {
  IPalWalletAddressDto,
  IPalWalletAddressKeyDto
} from 'pal-public-types-lib';
import {
  Collection,
  CollectionInfo,
  Db,
  MongoClient,
  MongoServerError
} from 'mongodb';
import {
  DuplicateWalletAddressKeyError,
  IPalWalletAddressRepository,
  IPalWalletAddressWithKeysDto
} from 'pal-domain-lib';
import { ILogger } from 'common-types-lib';

const DB_NAME = 'pal';
const COLLECTION_NAME: string = 'walletAddresses';
const KEY_COLLECTION_NAME: string = 'walletAddressKeys';
const TIMEOUT_MS: number = 5_000;

export class MongoDbWalletRepo implements IPalWalletAddressRepository {
  private _logger: ILogger;
  private readonly _connectionString: string;
  private _client!: MongoClient;
  private _collection!: Collection<IPalWalletAddressDto>;
  private _keyCollection!: Collection<IPalWalletAddressKeyDto>;

  constructor(connectionString: string, logger: ILogger) {
    this._connectionString = connectionString;
    this._logger = logger.child(this.constructor.name);
  }

  private _checkInitialisedOrThrow(): boolean {
    if (!this._client || !this._collection || !this._keyCollection) {
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
      const collectionNames = new Set(
        collections.map((collection) => collection.name)
      );

      // load or create the collection (and add its indexes) - should check version and perform migrations
      if (collectionNames.has(COLLECTION_NAME)) {
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

      if (collectionNames.has(KEY_COLLECTION_NAME)) {
        this._keyCollection =
          db.collection<IPalWalletAddressKeyDto>(KEY_COLLECTION_NAME);
      } else {
        this._keyCollection =
          await db.createCollection<IPalWalletAddressKeyDto>(
            KEY_COLLECTION_NAME
          );
        await this._keyCollection.createIndex({ id: 1 }, { unique: true });
        await this._keyCollection.createIndex(
          { walletAddressId: 1, 'jwk.kid': 1 },
          { unique: true }
        );
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
        {
          $set: {
            id: walletAddress.id,
            publicName: walletAddress.publicName,
            isActive: walletAddress.isActive,
            assetCode: walletAddress.assetCode,
            assetScale: walletAddress.assetScale,
            aliases: walletAddress.aliases
          }
        },
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

  async storeKey(key: IPalWalletAddressKeyDto): Promise<void> {
    this._checkInitialisedOrThrow();

    try {
      await this._keyCollection.updateOne(
        { id: key.id },
        { $set: key },
        { upsert: true }
      );
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000) {
        throw new DuplicateWalletAddressKeyError(
          `Wallet address key with kid ${key.jwk.kid} already exists`
        );
      }
      this._logger.error(e);
      throw new Error(
        `Unable to store wallet address key - error: ${(e as Error).message}`
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

      return docs.map((doc) => this._toWalletDto(doc));
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to get wallet by address - error: ${(e as Error).message}`
      );
    }
  }

  async fetchWithKeys(
    id: string
  ): Promise<IPalWalletAddressWithKeysDto | null> {
    this._checkInitialisedOrThrow();

    try {
      const [doc, keyDocs] = await Promise.all([
        this._collection.findOne({ id: id }),
        this._keyCollection.find({ walletAddressId: id }).toArray()
      ]);

      if (!doc) {
        return null;
      }

      return {
        ...this._toWalletDto(doc),
        keys: keyDocs.map((keyDoc) => this._toKeyDto(keyDoc))
      };
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to get wallet with keys - error: ${(e as Error).message}`
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

      return this._toWalletDto(doc);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to get wallet by address - error: ${(e as Error).message}`
      );
    }
  }

  private _toWalletDto(doc: IPalWalletAddressDto): IPalWalletAddressDto {
    return {
      id: doc.id,
      publicName: doc.publicName,
      isActive: doc.isActive,
      assetCode: doc.assetCode,
      assetScale: doc.assetScale,
      aliases: doc.aliases
    };
  }

  private _toKeyDto(doc: IPalWalletAddressKeyDto): IPalWalletAddressKeyDto {
    return {
      id: doc.id,
      walletAddressId: doc.walletAddressId,
      jwk: {
        kid: doc.jwk.kid,
        alg: doc.jwk.alg,
        kty: doc.jwk.kty,
        crv: doc.jwk.crv,
        x: doc.jwk.x,
        ...(doc.jwk.use ? { use: doc.jwk.use } : {})
      },
      revoked: doc.revoked === true,
      ...(doc.revokedAt ? { revokedAt: new Date(doc.revokedAt) } : {})
    };
  }
}
