import { Collection, CollectionInfo, Db, MongoClient, WithId } from 'mongodb';
import { IAccessToken, IGrant, IGrantRepository } from 'auth-domain-lib';
import { ILogger } from 'common-types-lib';

const DB_NAME = 'auth';
const GRANTS_COLLECTION_NAME = 'grants';
const ACCESS_TOKENS_COLLECTION_NAME = 'access_tokens';
const TIMEOUT_MS = 5_000;

type GrantDoc = Omit<IGrant, 'accessTokens'>;

interface AccessTokenDoc extends IAccessToken {
  grantId: string;
}

export class MongoDbGrantRepo implements IGrantRepository {
  private readonly _connectionString: string;
  private readonly _logger: ILogger;
  private _client!: MongoClient;
  private _grantCollection!: Collection<GrantDoc>;
  private _accessTokenCollection!: Collection<AccessTokenDoc>;

  constructor(connectionString: string, logger: ILogger) {
    this._connectionString = connectionString;
    this._logger = logger;
  }

  private _checkInitialisedOrThrow(): boolean {
    if (
      !this._client ||
      !this._grantCollection ||
      !this._accessTokenCollection
    ) {
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

      // Check which collections already exist.
      const collections: (
        | Pick<CollectionInfo, 'name' | 'type'>
        | CollectionInfo
      )[] = await db.listCollections().toArray();
      const collectionNames = new Set(
        collections.map((collection) => collection.name)
      );

      // Load or create the collections (and add their indexes) - should
      // check version and perform migrations.
      if (collectionNames.has(GRANTS_COLLECTION_NAME)) {
        this._grantCollection = db.collection<GrantDoc>(GRANTS_COLLECTION_NAME);
      } else {
        this._grantCollection = await db.createCollection<GrantDoc>(
          GRANTS_COLLECTION_NAME
        );
        await this._grantCollection.createIndex({ id: 1 }, { unique: true });
      }

      if (collectionNames.has(ACCESS_TOKENS_COLLECTION_NAME)) {
        this._accessTokenCollection = db.collection<AccessTokenDoc>(
          ACCESS_TOKENS_COLLECTION_NAME
        );
      } else {
        this._accessTokenCollection = await db.createCollection<AccessTokenDoc>(
          ACCESS_TOKENS_COLLECTION_NAME
        );
        await this._accessTokenCollection.createIndex(
          { value: 1 },
          { unique: true }
        );
        await this._accessTokenCollection.createIndex({ grantId: 1 });
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

  private _docToGrant(
    doc: WithId<GrantDoc>,
    tokenDocs: AccessTokenDoc[]
  ): IGrant {
    return {
      id: doc.id,
      startMethods: doc.startMethods,
      continueToken: doc.continueToken,
      continueId: doc.continueId,
      state: doc.state,
      finalizationReason: doc.finalizationReason,
      client: doc.client,
      subjectIds: doc.subjectIds,
      accesses: doc.accesses,
      finishNonce: doc.finishNonce,
      finishMethod: doc.finishMethod,
      finishUri: doc.finishUri,
      interactionNonce: doc.interactionNonce,
      interaction: doc.interaction,
      lastContinuedAt: doc.lastContinuedAt,
      accessTokens: tokenDocs
    };
  }

  async storeMany(grants: IGrant[]): Promise<void> {
    this._checkInitialisedOrThrow();

    if (grants.length === 0) return;

    try {
      await this._grantCollection.insertMany(
        grants.map((grant) => ({
          id: grant.id,
          startMethods: grant.startMethods,
          continueToken: grant.continueToken,
          continueId: grant.continueId,
          state: grant.state,
          finalizationReason: grant.finalizationReason,
          client: grant.client,
          subjectIds: grant.subjectIds,
          accesses: grant.accesses,
          finishNonce: grant.finishNonce,
          finishMethod: grant.finishMethod,
          finishUri: grant.finishUri,
          interactionNonce: grant.interactionNonce,
          interaction: grant.interaction,
          lastContinuedAt: grant.lastContinuedAt
        }))
      );

      const accessTokenDocs = grants.flatMap((grant) =>
        [...grant.accessTokens.values()].map((token) => ({
          grantId: grant.id,
          value: token.value,
          managementId: token.managementId,
          expiresInMs: token.expiresInMs,
          createdAt: token.createdAt,
          revokedAt: token.revokedAt
        }))
      );

      if (accessTokenDocs.length > 0) {
        await this._accessTokenCollection.insertMany(accessTokenDocs);
      }
    } catch (err) {
      this._logger.error(err);
      throw new Error(
        `Unable to store grants - error: ${(err as Error).message}`
      );
    }
  }

  async fetchById(id: string): Promise<IGrant | undefined> {
    this._checkInitialisedOrThrow();

    try {
      const doc = await this._grantCollection.findOne({ id });
      if (!doc) return undefined;

      const tokenDocs = await this._accessTokenCollection
        .find({ grantId: id })
        .toArray();

      return this._docToGrant(doc, tokenDocs);
    } catch (err) {
      this._logger.error(err);
      throw new Error(
        `Unable to fetch grant ${id} - error: ${(err as Error).message}`
      );
    }
  }

  async fetchByIds(ids: string[]): Promise<IGrant[]> {
    this._checkInitialisedOrThrow();

    if (ids.length === 0) return [];

    try {
      const docs = await this._grantCollection
        .find({ id: { $in: ids } })
        .toArray();

      const tokenDocs = await this._accessTokenCollection
        .find({ grantId: { $in: ids } })
        .toArray();

      const tokensByGrantId = new Map<string, AccessTokenDoc[]>();
      for (const tokenDoc of tokenDocs) {
        const existing = tokensByGrantId.get(tokenDoc.grantId);
        if (existing) {
          existing.push(tokenDoc);
        } else {
          tokensByGrantId.set(tokenDoc.grantId, [tokenDoc]);
        }
      }

      return docs.map((doc) =>
        this._docToGrant(doc, tokensByGrantId.get(doc.id) ?? [])
      );
    } catch (err) {
      this._logger.error(err);
      throw new Error(
        `Unable to fetch grants - error: ${(err as Error).message}`
      );
    }
  }
}
