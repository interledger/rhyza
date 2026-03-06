/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

import { Collection, CollectionInfo, Db, MongoClient } from 'mongodb';
import { IPalAsset, IPalAssetRepository } from 'pal-domain-lib';
import * as console from 'node:console';

const DB_NAME = 'pal';
const COLLECTION_NAME: string = 'assets';
const TIMEOUT_MS: number = 5_000;

export class MongoDbAssetRepo implements IPalAssetRepository {
  private readonly _connectionString: string;
  private _client!: MongoClient;
  private _collection!: Collection<IPalAsset>;

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
        this._collection = db.collection<IPalAsset>(COLLECTION_NAME);
      } else {
        this._collection =
          await db.createCollection<IPalAsset>(COLLECTION_NAME);
        await this._collection.createIndex({ code: 1 }, { unique: true });
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

  async store(asset: IPalAsset): Promise<void> {
    this._checkInitialisedOrThrow();

    try {
      await this._collection.insertOne(asset);
      return;
    } catch (e) {
      console.error(e);
      throw new Error(`Unable to store asset - error: ${(e as Error).message}`);
    }
  }

  async fetch(code: string): Promise<IPalAsset | null> {
    this._checkInitialisedOrThrow();

    try {
      const doc = await this._collection.findOne({ code: code });
      if (!doc) {
        return null;
      }
      return {
        code: doc.code,
        scale: doc.scale,
        liquidityLowThreshold: doc.liquidityLowThreshold || null,
        liquidityHighThreshold: doc.liquidityHighThreshold || null
      };
    } catch (e) {
      console.error(e);
      throw new Error(
        `Unable to get asset by code - error: ${(e as Error).message}`
      );
    }
  }
}
