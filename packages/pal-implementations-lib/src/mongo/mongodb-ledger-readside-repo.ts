import {
  Collection,
  CollectionInfo,
  Db,
  InsertManyResult,
  MongoClient
} from 'mongodb';
import { ILedgerReadSideRepository } from 'pal-domain-lib';
import {
  ILedgerDto,
  ILedgerAccountDto,
  ILedgerTransactionDto
} from 'pal-public-types-lib';
import { ILogger } from 'common-types-lib';
const DB_NAME = 'pal';
const TIMEOUT_MS: number = 5_000;
const LEDGERS_COLLECTION_NAME: string = 'ledgers';
const LEDGER_ACCOUNTS_COLLECTION_NAME: string = 'ledgerAccounts';
const LEDGER_TRANSACTIONS_COLLECTION_NAME: string = 'ledgerTransactions';

export class MongoDbLedgerReadSideRepo implements ILedgerReadSideRepository {
  private _logger: ILogger;
  private readonly _connectionString: string;
  private _client!: MongoClient;
  private _ledgersCol!: Collection<ILedgerDto>;
  private _accountsCol!: Collection<ILedgerAccountDto>;
  private _transactionsCol!: Collection<ILedgerTransactionDto>;

  constructor(connectionString: string, logger: ILogger) {
    this._connectionString = connectionString;
    this._logger = logger;
  }

  private _checkInitialisedOrThrow(): boolean {
    if (
      !this._client ||
      !this._ledgersCol ||
      !this._accountsCol ||
      !this._transactionsCol
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

      // Check if the collection already exists.
      const collections: Pick<CollectionInfo, 'name' | 'type'>[] = await db
        .listCollections()
        .toArray();

      if (collections.some((col) => col.name === LEDGERS_COLLECTION_NAME)) {
        this._ledgersCol = db.collection<ILedgerDto>(LEDGERS_COLLECTION_NAME);
      } else {
        this._ledgersCol = await db.createCollection<ILedgerDto>(
          LEDGERS_COLLECTION_NAME
        );
        await this._ledgersCol.createIndex({ id: 1 }, { unique: true });
      }

      if (
        collections.some((col) => col.name === LEDGER_ACCOUNTS_COLLECTION_NAME)
      ) {
        this._accountsCol = db.collection<ILedgerAccountDto>(
          LEDGER_ACCOUNTS_COLLECTION_NAME
        );
      } else {
        this._accountsCol = await db.createCollection<ILedgerAccountDto>(
          LEDGER_ACCOUNTS_COLLECTION_NAME
        );
        await this._accountsCol.createIndex({ id: 1 }, { unique: true });
      }

      if (
        collections.some(
          (col) => col.name === LEDGER_TRANSACTIONS_COLLECTION_NAME
        )
      ) {
        this._transactionsCol = db.collection<ILedgerTransactionDto>(
          LEDGER_TRANSACTIONS_COLLECTION_NAME
        );
      } else {
        this._transactionsCol =
          await db.createCollection<ILedgerTransactionDto>(
            LEDGER_TRANSACTIONS_COLLECTION_NAME
          );
        await this._transactionsCol.createIndex({ id: 1 }, { unique: true });
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

  /*
   * Ledger Methods
   * */
  async storeLedgers(ledgers: ILedgerDto[]): Promise<void> {
    this._checkInitialisedOrThrow();

    try {
      const operations = ledgers.map((l) => ({
        updateOne: {
          filter: { id: l.id },
          update: { $set: l },
          upsert: true
        }
      }));
      await this._ledgersCol.bulkWrite(operations);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to update ledger - error: ${(e as Error).message}`
      );
    }

    return;
  }

  async fetchLedgers(ids: string[]): Promise<ILedgerDto[]> {
    this._checkInitialisedOrThrow();

    try {
      const docs = await this._ledgersCol.find({ id: { $in: ids } }).toArray();

      if (!docs || docs.length === 0) {
        return [];
      }

      return docs;
    } catch (e) {
      this._logger.error(e);
      throw new Error(`Unable to get ledgers - error: ${(e as Error).message}`);
    }
  }

  /*
   * Ledger accounts Methods
   * */
  async storeLedgerAccounts(accounts: ILedgerAccountDto[]): Promise<void> {
    this._checkInitialisedOrThrow();

    try {
      // Map your data to the bulkWrite structure
      const operations = accounts.map((a) => ({
        updateOne: {
          filter: { id: a.id }, // Unique identifier
          update: { $set: a },
          upsert: true
        }
      }));
      await this._accountsCol.bulkWrite(operations, { ordered: false });
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to update ledger - error: ${(e as Error).message}`
      );
    }

    return;
  }

  async fetchLedgerAccounts(ids: string[]): Promise<ILedgerAccountDto[]> {
    this._checkInitialisedOrThrow();

    try {
      const docs = await this._accountsCol.find({ id: { $in: ids } }).toArray();

      if (!docs || docs.length === 0) {
        return [];
      }

      return docs;
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to get ledger accounts - error: ${(e as Error).message}`
      );
    }
  }

  /*
   * Ledger transaction Methods
   * */
  async storeLedgerTransactions(
    transactions: ILedgerTransactionDto[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    // transactions cannot be modified, so we can just insert them all

    let result: InsertManyResult;
    try {
      const dtos = transactions.map((t) => t);
      result = await this._transactionsCol.insertMany(dtos);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to update ledger - error: ${(e as Error).message}`
      );
    }

    if (result.insertedCount !== transactions.length) {
      throw new Error(
        `Failed to upsert ${transactions.length} ledger transactions - only ${result.insertedCount} inserted out of ${transactions.length} requested`
      );
    }

    return;
  }
}
