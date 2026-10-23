import { Collection, CollectionInfo, Db, MongoClient, WithId } from 'mongodb';
import {
  IAccessToken,
  IGrant,
  IGrantRepository,
  IRevokedGrantUpdate,
  IRotatedGrantUpdate,
  IContinuedGrantUpdate,
  IFinishedInteractiveGrantUpdate,
  IUpdatedSpentAmountGrant
} from 'auth-domain-lib';
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
      createdAt: doc.createdAt,
      startMethods: doc.startMethods,
      continueToken: doc.continueToken,
      continueId: doc.continueId,
      lastContinuedAt: doc.lastContinuedAt
        ? new Date(doc.lastContinuedAt)
        : undefined,
      state: doc.state,
      client: doc.client,
      subjectIds: doc.subjectIds,
      accesses: doc.accesses,
      finishNonce: doc.finishNonce,
      finishMethod: doc.finishMethod,
      finishUri: doc.finishUri,
      interactionNonce: doc.interactionNonce,
      interaction: doc.interaction,
      spentAmounts: doc.spentAmounts,
      accessTokens: tokenDocs.map((token) => ({
        ...token,
        expiresInMs: token.expiresInMs,
        expiresAt: new Date(token.expiresAt),
        createdAt: new Date(token.createdAt),
        revokedAt: token.revokedAt ? new Date(token.revokedAt) : undefined
      }))
    };
  }

  async storeMany(grants: IGrant[]): Promise<void> {
    this._checkInitialisedOrThrow();

    if (grants.length === 0) return;

    try {
      await this._grantCollection.insertMany(
        grants.map((grant) => ({
          id: grant.id,
          createdAt: grant.createdAt,
          startMethods: grant.startMethods,
          continueToken: grant.continueToken,
          continueId: grant.continueId,
          lastContinuedAt: grant.lastContinuedAt,
          state: grant.state,
          client: grant.client,
          subjectIds: grant.subjectIds,
          accesses: grant.accesses,
          finishNonce: grant.finishNonce,
          finishMethod: grant.finishMethod,
          finishUri: grant.finishUri,
          interactionNonce: grant.interactionNonce,
          interaction: grant.interaction,
          spentAmounts: grant.spentAmounts
        }))
      );

      const accessTokenDocs = grants.flatMap((grant) =>
        grant.accessTokens.map((token) => ({
          grantId: grant.id,
          value: token.value,
          managementId: token.managementId,
          expiresInMs: token.expiresInMs,
          expiresAt: token.expiresAt,
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

  async storeRotatedGrants(updates: IRotatedGrantUpdate[]): Promise<void> {
    this._checkInitialisedOrThrow();

    if (updates.length === 0) return;

    try {
      const revokeOps = updates.map((u) => ({
        updateOne: {
          filter: { value: u.revokedToken.value },
          update: { $set: { revokedAt: u.revokedToken.revokedAt } }
        }
      }));

      await this._accessTokenCollection.bulkWrite(revokeOps, {
        ordered: false
      });

      const newTokenDocs = updates.map((u) => ({
        grantId: u.id,
        value: u.newToken.value,
        managementId: u.newToken.managementId,
        expiresInMs: u.newToken.expiresInMs,
        expiresAt: u.newToken.expiresAt,
        createdAt: u.newToken.createdAt
      }));

      await this._accessTokenCollection.insertMany(newTokenDocs);
    } catch (err) {
      this._logger.error(err);
      throw new Error(
        `Unable to store rotated grants - error: ${(err as Error).message}`
      );
    }
  }

  async storeContinuedGrants(grants: IContinuedGrantUpdate[]): Promise<void> {
    this._checkInitialisedOrThrow();

    if (grants.length === 0) return;

    try {
      await this._grantCollection.bulkWrite(
        grants.map((grant) => ({
          updateOne: {
            filter: { id: grant.id },
            update: {
              $set: {
                state: grant.state,
                continueToken: grant.continueToken,
                continueId: grant.continueId,
                lastContinuedAt: grant.lastContinuedAt
              }
            }
          }
        }))
      );

      const accessTokenWrites = grants.flatMap((grant) => {
        if (!grant.accessToken) return [];
        const token = grant.accessToken;
        return [
          {
            updateOne: {
              filter: { value: token.value },
              update: {
                $set: {
                  grantId: grant.id,
                  value: token.value,
                  managementId: token.managementId,
                  expiresInMs: token.expiresInMs,
                  expiresAt: token.expiresAt,
                  createdAt: token.createdAt,
                  revokedAt: token.revokedAt
                }
              },
              upsert: true
            }
          }
        ];
      });

      if (accessTokenWrites.length > 0) {
        await this._accessTokenCollection.bulkWrite(accessTokenWrites);
      }
    } catch (err) {
      this._logger.error(err);
      throw new Error(
        `Unable to store continued grants - error: ${(err as Error).message}`
      );
    }
  }

  async storeFinishedInteractiveGrants(
    grants: IFinishedInteractiveGrantUpdate[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (grants.length === 0) return;

    try {
      await this._grantCollection.bulkWrite(
        grants.map((grant) => ({
          updateOne: {
            filter: { id: grant.id },
            update: {
              $set: {
                state: grant.state
              }
            }
          }
        })),
        { ordered: false }
      );
    } catch (err) {
      this._logger.error(err);
      throw new Error(
        `Unable to store finished interactive grants - error: ${(err as Error).message}`
      );
    }
  }

  async storeRevokedGrants(grants: IRevokedGrantUpdate[]): Promise<void> {
    this._checkInitialisedOrThrow();

    if (grants.length === 0) return;

    try {
      await this._grantCollection.bulkWrite(
        grants.map((grant) => ({
          updateOne: {
            filter: { id: grant.id },
            update: {
              $set: {
                state: grant.state,
                continueToken: undefined,
                continueId: undefined
              }
            }
          }
        })),
        { ordered: false }
      );
    } catch (err) {
      this._logger.error(err);
      throw new Error(
        `Unable to store revoked grants - error: ${(err as Error).message}`
      );
    }
  }

  async storeUpdatedSpentAmountGrants(
    grants: IUpdatedSpentAmountGrant[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (grants.length === 0) return;

    try {
      await this._grantCollection.bulkWrite(
        grants.map((grant) => ({
          updateOne: {
            filter: { id: grant.id },
            update: {
              $set: {
                spentAmounts: grant.spentAmounts
              }
            }
          }
        })),
        { ordered: false }
      );
    } catch (err) {
      this._logger.error(err);
      throw new Error(
        `Unable to store updated spent amount grants - error: ${(err as Error).message}`
      );
    }
  }

  async storeRevokedTokens(tokens: IAccessToken[]): Promise<void> {
    this._checkInitialisedOrThrow();

    if (tokens.length === 0) return;

    try {
      await this._accessTokenCollection.bulkWrite(
        tokens.map((token) => ({
          updateOne: {
            filter: { value: token.value },
            update: {
              $set: {
                revokedAt: token.revokedAt
              }
            }
          }
        })),
        { ordered: false }
      );
    } catch (err) {
      this._logger.error(err);
      throw new Error(
        `Unable to store revoked tokens - error: ${(err as Error).message}`
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

  async storeInteractions(grants: IGrant[]): Promise<void> {
    this._checkInitialisedOrThrow();

    if (grants.length === 0) return;

    try {
      await this._grantCollection.bulkWrite(
        grants.map((update) => ({
          updateOne: {
            filter: { id: update.id },
            update: {
              $set: { interaction: update.interaction }
            }
          }
        }))
      );
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store interactions for grants - error: ${(e as Error).message}`
      );
    }
  }
}
