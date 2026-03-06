/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

import { Collection, CollectionInfo, Db, MongoClient } from 'mongodb';
import { IPalWalletAddress, IPalWalletAddressRepository } from 'pal-domain-lib';
import * as console from 'node:console';

const DB_NAME = 'pal';
const COLLECTION_NAME: string = 'walletAddresses';
const TIMEOUT_MS: number = 5_000;

export class MongoDbWalletRepoRepo implements IPalWalletAddressRepository {
  private readonly _connectionString: string;
  private _client!: MongoClient;
  private _collection!: Collection<IPalWalletAddress>;

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
      const collectionExists: boolean = collections.some((collection) => {
        return collection.name === COLLECTION_NAME;
      });

      // load or create the collection (and add its indexes) - should check version and perform migrations
      if (collectionExists) {
        this._collection = db.collection<IPalWalletAddress>(COLLECTION_NAME);
      } else {
        this._collection =
          await db.createCollection<IPalWalletAddress>(COLLECTION_NAME);
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

  async store(walletAddress: IPalWalletAddress): Promise<void> {
    this._checkInitialisedOrThrow();

    try {
      await this._collection.insertOne(walletAddress);
      return;
    } catch (e) {
      console.error(e);
      throw new Error(
        `Unable to store wallet address - error: ${(e as Error).message}`
      );
    }
  }

  async fetch(ids: string[]): Promise<IPalWalletAddress[]> {
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
          assetScale: doc.assetScale
        };
      });
    } catch (e) {
      console.error(e);
      throw new Error(
        `Unable to get wallet by address - error: ${(e as Error).message}`
      );
    }
  }
}
