import {
  INotification,
  INotificationRepository,
  NotificationStatus
} from 'notifications-domain-lib';
import { Collection, CollectionInfo, Db, MongoClient } from 'mongodb';

const DB_NAME = 'notifications';
const COLLECTION_NAME = 'notifications';
const TIMEOUT_MS = 5_000;

export class MongoDbNotificationRepo implements INotificationRepository {
  private _client!: MongoClient;
  private _connectionString: string;
  private _notificationCollection!: Collection<INotification>;

  constructor(connectionString: string) {
    this._connectionString = connectionString;
  }

  private _checkInitialisedOrThrow(): boolean {
    if (!this._client || !this._notificationCollection) {
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
      const collections: (
        | Pick<CollectionInfo, 'name' | 'type'>
        | CollectionInfo
      )[] = await db.listCollections().toArray();
      const notificationCollectionExists = collections.some(
        (collection) => collection.name === COLLECTION_NAME
      );
      if (notificationCollectionExists) {
        this._notificationCollection =
          db.collection<INotification>(COLLECTION_NAME);
      } else {
        this._notificationCollection =
          await db.createCollection<INotification>(COLLECTION_NAME);
        await this._notificationCollection.createIndex(
          { id: 1 },
          { unique: true }
        );
        await this._notificationCollection.createIndex(
          { status: 1, createdAt: 1 },
          {
            partialFilterExpression: {
              status: NotificationStatus.PENDING_RETRY
            }
          }
        );
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

  async get(id: string): Promise<INotification | null> {
    this._checkInitialisedOrThrow();
    try {
      return await this._notificationCollection.findOne({ id });
    } catch (e: unknown) {
      this._handleError(e, 'get');
    }
  }

  async store(notification: INotification): Promise<void> {
    this._checkInitialisedOrThrow();
    try {
      await this._notificationCollection.updateOne(
        { id: notification.id },
        { $set: notification },
        { upsert: true }
      );
    } catch (e: unknown) {
      this._handleError(e, 'store');
    }
  }

  async getPendingRetryNotificationIds(limit: number): Promise<string[]> {
    this._checkInitialisedOrThrow();
    try {
      const documents = await this._notificationCollection
        .find({
          status: NotificationStatus.PENDING_RETRY
        })
        .project({ _id: 0, id: 1 })
        .sort({ createdAt: 1 })
        .limit(limit)
        .toArray();

      return documents.map((doc) => doc.id);
    } catch (e: unknown) {
      this._handleError(e, 'getFailedNotifications');
    }
  }

  private _handleError(e: unknown, action: string): never {
    if (e instanceof Error) {
      console.error(e);
      throw e;
    }
    const error = new Error(
      `Unable to ${action} notification: 'unknown error'`
    );
    console.error(error);
    throw error;
  }
}
