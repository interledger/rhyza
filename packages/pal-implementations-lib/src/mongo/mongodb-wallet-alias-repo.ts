/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

import { Collection, CollectionInfo, Db, MongoClient } from 'mongodb';
import {
  IPalWalletAddressAlias,
  IPalWalletAddressAliasRepository
} from 'pal-domain-lib';
import * as console from 'node:console';

const DB_NAME = 'pal';
const COLLECTION_NAME: string = 'walletAddressAliases';
const TIMEOUT_MS: number = 5_000;

export class MongoWalletAddressAliasRepo
  implements IPalWalletAddressAliasRepository
{
  private readonly _connectionString: string;
  private _client!: MongoClient;
  private _collection!: Collection<IPalWalletAddressAlias>;

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
        this._collection =
          db.collection<IPalWalletAddressAlias>(COLLECTION_NAME);
      } else {
        this._collection =
          await db.createCollection<IPalWalletAddressAlias>(COLLECTION_NAME);
        await this._collection.createIndex({ pathName: 1 }, { unique: false });
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

  async store(alias: IPalWalletAddressAlias): Promise<void> {
    this._checkInitialisedOrThrow();

    try {
      await this._collection.insertOne(alias);
      return;
    } catch (e) {
      console.error(e);
      throw new Error(
        `Unable to store wallet address alias - error: ${(e as Error).message}`
      );
    }
  }

  async fetch(
    domain: string | null,
    pathName: string
  ): Promise<IPalWalletAddressAlias | null> {
    this._checkInitialisedOrThrow();

    try {
      const doc = await this._collection.findOne({
        domain: domain,
        pathName: pathName
      });

      if (!doc) {
        return null;
      }

      return {
        domain: doc.domain,
        pathName: doc.pathName,
        walletId: doc.walletId
      };
    } catch (e) {
      console.error(e);
      throw new Error(
        `Unable to get wallet address alias by domain and pathName - error: ${(e as Error).message}`
      );
    }
  }
}
