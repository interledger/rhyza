import { Collection, CollectionInfo, Db, Filter, MongoClient } from 'mongodb';
import {
  DEFAULT_SORT_ORDER,
  FinalizedRemoteQuoteUpdate,
  InvalidCursorError,
  IPage,
  IPageOpts,
  IStoredSentPayment,
  ISentPayment,
  isRemoteSentPayment,
  PaymentIntentDestination,
  IPaymentIntent,
  IPaymentIntentRepository,
  IInboundPayment,
  PaymentIntentState,
  SentPaymentState,
  SortOrder,
  InboundPaymentState
} from 'payments-domain-lib';
import { ILogger, InvalidArgument } from 'common-types-lib';

const DB_NAME = 'payments';
const PAYMENT_INTENTS_COLLECTION_NAME = 'paymentIntents';
const SENT_PAYMENTS_COLLECTION_NAME = 'sentPayments';
const INBOUND_PAYMENTS_COLLECTION_NAME = 'inboundPayments';
const TIMEOUT_MS = 5_000;

/**
 * Turns a stored row into the domain object by supplying the parent intent's
 * destination, which rows do not carry, and asserting what each arm needs.
 * Spreading the rest means a newly stored field cannot be forgotten here.
 */
function toSentPayment(
  row: IStoredSentPayment,
  destination: PaymentIntentDestination
): ISentPayment {
  const { peerId, ledgerTransferId, failReason, receiveAmount, ...base } = row;

  if (destination === 'REMOTE') {
    if (!peerId) {
      throw new Error(`Stored remote payment ${row.id} has no peerId`);
    }
    return {
      ...base,
      destination: 'REMOTE',
      peerId,
      receiveAmount,
      ledgerTransferId,
      failReason
    };
  }

  if (receiveAmount === null) {
    throw new Error(`Stored local payment ${row.id} has no receiveAmount`);
  }
  return { ...base, destination: 'LOCAL', receiveAmount };
}

export class MongoDbPaymentIntentRepo implements IPaymentIntentRepository {
  private readonly _connectionString: string;
  private readonly _logger: ILogger;
  private _client!: MongoClient;
  private _paymentIntentCollection!: Collection<
    Omit<IPaymentIntent, 'sentPayments' | 'inboundPayments'>
  >;
  private _sentPaymentCollection!: Collection<IStoredSentPayment>;
  private _inboundPaymentCollection!: Collection<IInboundPayment>;

  constructor(connectionString: string, logger: ILogger) {
    this._connectionString = connectionString;
    this._logger = logger;
  }

  private _checkInitialisedOrThrow(): boolean {
    if (!this._client || !this._paymentIntentCollection) {
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

      // Check if the collections already exist.
      const collections: (
        | Pick<CollectionInfo, 'name' | 'type'>
        | CollectionInfo
      )[] = await db.listCollections().toArray();

      const paymentIntentsCollectionExists = collections.some(
        (collection) => collection.name === PAYMENT_INTENTS_COLLECTION_NAME
      );

      // load or create the collection (and add its indexes) - should check version and perform migrations
      if (paymentIntentsCollectionExists) {
        this._paymentIntentCollection = db.collection(
          PAYMENT_INTENTS_COLLECTION_NAME
        );
      } else {
        this._paymentIntentCollection = await db.createCollection(
          PAYMENT_INTENTS_COLLECTION_NAME
        );
        await this._paymentIntentCollection.createIndex(
          { id: 1 },
          { unique: true }
        );
        await this._paymentIntentCollection.createIndex(
          { remoteUrl: 1 },
          { unique: true, sparse: true }
        );
        // supports keyset pagination filtered by receiver wallet address
        await this._paymentIntentCollection.createIndex({
          receiverWalletAddressId: 1,
          createdAt: 1,
          id: 1
        });
        await this._paymentIntentCollection.createIndex({
          expiresAt: 1
        });
      }

      const paymentsCollectionExists = collections.some(
        (collection) => collection.name === SENT_PAYMENTS_COLLECTION_NAME
      );
      // load or create the collection (and add its indexes) - should check version and perform migrations
      if (paymentsCollectionExists) {
        this._sentPaymentCollection = db.collection<IStoredSentPayment>(
          SENT_PAYMENTS_COLLECTION_NAME
        );
      } else {
        this._sentPaymentCollection =
          await db.createCollection<IStoredSentPayment>(
            SENT_PAYMENTS_COLLECTION_NAME
          );
        await this._sentPaymentCollection.createIndex(
          { id: 1 },
          { unique: true }
        );
        await this._sentPaymentCollection.createIndex({
          paymentIntentId: 1
        });
        // supports keyset pagination filtered by sender wallet address
        await this._sentPaymentCollection.createIndex({
          senderWalletAddressId: 1,
          createdAt: 1,
          id: 1
        });
        await this._sentPaymentCollection.createIndex({
          expiresAt: 1
        });
      }

      const inboundPaymentsCollectionExists = collections.some(
        (collection) => collection.name === INBOUND_PAYMENTS_COLLECTION_NAME
      );
      // load or create the collection (and add its indexes) - should check version and perform migrations
      if (inboundPaymentsCollectionExists) {
        this._inboundPaymentCollection = db.collection<IInboundPayment>(
          INBOUND_PAYMENTS_COLLECTION_NAME
        );
      } else {
        this._inboundPaymentCollection =
          await db.createCollection<IInboundPayment>(
            INBOUND_PAYMENTS_COLLECTION_NAME
          );
        await this._inboundPaymentCollection.createIndex(
          { id: 1 },
          { unique: true }
        );
        await this._inboundPaymentCollection.createIndex({
          paymentIntentId: 1
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

  async storeMany(payments: IPaymentIntent[]): Promise<void> {
    this._checkInitialisedOrThrow();

    if (payments.length === 0) return;

    try {
      await this._paymentIntentCollection.insertMany(
        payments.map((p) => {
          const doc: Omit<IPaymentIntent, 'sentPayments' | 'inboundPayments'> =
            {
              id: p.id,
              receiverWalletAddressId: p.receiverWalletAddressId,
              receiverWalletAddress: p.receiverWalletAddress,
              state: p.state,
              destination: p.destination,
              assetCode: p.assetCode,
              assetScale: p.assetScale,
              createdAt: p.createdAt,
              expiresAt: p.expiresAt,
              incomingAmount: p.incomingAmount,
              receivedAmount: p.receivedAmount,
              destinationIlpAddress: p.destinationIlpAddress,
              quotes: p.quotes
            };
          if (p.metadata != null) doc.metadata = p.metadata;
          if (p.remoteUrl != null) doc.remoteUrl = p.remoteUrl;
          return doc;
        })
      );
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store payment intents - error: ${(e as Error).message}`
      );
    }
  }

  async storeCompletedPaymentIntents(
    paymentIntents: { id: string; state: PaymentIntentState }[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (paymentIntents.length === 0) return;

    try {
      await this._paymentIntentCollection.bulkWrite(
        paymentIntents.map((paymentIntent) => ({
          updateOne: {
            filter: { id: paymentIntent.id },
            update: {
              $set: {
                state: paymentIntent.state
              }
            }
          }
        }))
      );
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store completed payment intents - error: ${(e as Error).message}`
      );
    }
  }

  async fetchByIds(
    ids: string[]
  ): Promise<Omit<IPaymentIntent, 'sentPayments' | 'inboundPayments'>[]> {
    this._checkInitialisedOrThrow();

    if (ids.length === 0) return [];

    try {
      const docs = await this._paymentIntentCollection
        .find({ id: { $in: ids } })
        .toArray();

      return docs.map((doc) => ({
        id: doc.id,
        receiverWalletAddressId: doc.receiverWalletAddressId,
        receiverWalletAddress: doc.receiverWalletAddress,
        state: doc.state,
        destination: doc.destination,
        assetCode: doc.assetCode,
        assetScale: doc.assetScale,
        createdAt: doc.createdAt,
        expiresAt: doc.expiresAt,
        incomingAmount: doc.incomingAmount,
        receivedAmount: doc.receivedAmount,
        destinationIlpAddress: doc.destinationIlpAddress,
        remoteUrl: doc.remoteUrl,
        quotes: doc.quotes.map((quote) => ({ ...quote })),
        metadata: doc.metadata
      }));
    } catch (err) {
      this._logger.error(err);
      throw new Error(
        `Unable to fetch payment intents - error: ${(err as Error).message}`
      );
    }
  }

  async fetchByIdsWithPayments(ids: string[]): Promise<IPaymentIntent[]> {
    this._checkInitialisedOrThrow();

    if (ids.length === 0) return [];

    try {
      const [paymentIntentDocs, paymentDocs, inboundPaymentDocs] =
        await Promise.all([
          this._paymentIntentCollection.find({ id: { $in: ids } }).toArray(),
          this._sentPaymentCollection
            .find({ paymentIntentId: { $in: ids } }, { projection: { _id: 0 } })
            .toArray(),
          this._inboundPaymentCollection
            .find({ paymentIntentId: { $in: ids } })
            .toArray()
        ]);

      return paymentIntentDocs.map((doc) => ({
        id: doc.id,
        receiverWalletAddressId: doc.receiverWalletAddressId,
        receiverWalletAddress: doc.receiverWalletAddress,
        state: doc.state,
        destination: doc.destination,
        assetCode: doc.assetCode,
        assetScale: doc.assetScale,
        createdAt: doc.createdAt,
        expiresAt: doc.expiresAt,
        incomingAmount: doc.incomingAmount,
        receivedAmount: doc.receivedAmount,
        destinationIlpAddress: doc.destinationIlpAddress,
        remoteUrl: doc.remoteUrl,
        // Faithfully round-trip whatever the entity persisted for each quote.
        // Do NOT re-project by state — that silently drops fields (e.g. a
        // pending remote quote's peer/source/sender fields).
        quotes: doc.quotes.map((quote) => ({ ...quote })),
        metadata: doc.metadata,
        sentPayments: paymentDocs
          .filter((p) => p.paymentIntentId === doc.id)
          .map((payment) => toSentPayment(payment, doc.destination)),
        inboundPayments: inboundPaymentDocs
          .filter((rp) => rp.paymentIntentId === doc.id)
          .map((inboundPayment) => ({
            id: inboundPayment.id,
            state: inboundPayment.state,
            createdAt: inboundPayment.createdAt,
            paymentIntentId: inboundPayment.paymentIntentId,
            packetId: inboundPayment.packetId,
            peerId: inboundPayment.peerId,
            peerAssetCode: inboundPayment.peerAssetCode,
            peerAssetScale: inboundPayment.peerAssetScale,
            sourceAmount: inboundPayment.sourceAmount,
            receiveAmount: inboundPayment.receiveAmount,
            expiresAt: inboundPayment.expiresAt,
            ledgerTransferId: inboundPayment.ledgerTransferId,
            failReason: inboundPayment.failReason
          }))
      }));
    } catch (err) {
      this._logger.error(err);
      throw new Error(
        `Unable to fetch payment intents - error: ${(err as Error).message}`
      );
    }
  }

  async fetchIdsByRemoteUrls(
    urls: string[]
  ): Promise<Array<{ id: string; remoteUrl: string }>> {
    this._checkInitialisedOrThrow();

    if (urls.length === 0) return [];

    try {
      const docs = (await this._paymentIntentCollection
        .find(
          { remoteUrl: { $in: urls } },
          { projection: { _id: 0, id: 1, remoteUrl: 1 } }
        )
        .toArray()) as Array<{ id: string; remoteUrl: string }>;

      return docs;
    } catch (err) {
      this._logger.error(err);
      throw new Error(
        `Unable to fetch payment intent ids by remote URLs - error: ${(err as Error).message}`
      );
    }
  }

  async fetchPaymentIntentsPage(
    opts: IPageOpts
  ): Promise<IPage<Omit<IPaymentIntent, 'sentPayments' | 'inboundPayments'>>> {
    this._checkInitialisedOrThrow();

    try {
      const filter: Record<string, unknown> = {};
      if (opts.walletAddressId != null) {
        filter['receiverWalletAddressId'] = opts.walletAddressId;
      }

      const page = await this._fetchPageDocs(
        this._paymentIntentCollection,
        filter,
        opts
      );

      return {
        ...page,
        items: page.items.map((doc) => ({
          id: doc.id,
          receiverWalletAddressId: doc.receiverWalletAddressId,
          receiverWalletAddress: doc.receiverWalletAddress,
          state: doc.state,
          destination: doc.destination,
          assetCode: doc.assetCode,
          assetScale: doc.assetScale,
          createdAt: doc.createdAt,
          expiresAt: doc.expiresAt,
          incomingAmount: doc.incomingAmount,
          receivedAmount: doc.receivedAmount,
          destinationIlpAddress: doc.destinationIlpAddress,
          remoteUrl: doc.remoteUrl,
          quotes: doc.quotes.map((quote) => ({ ...quote })),
          metadata: doc.metadata
        }))
      };
    } catch (err) {
      if (err instanceof InvalidArgument) throw err;
      this._logger.error(err);
      throw new Error(
        `Unable to fetch payment intents page - error: ${(err as Error).message}`
      );
    }
  }

  async fetchSentPaymentsPage(
    opts: IPageOpts & { paymentIntentId?: string }
  ): Promise<IPage<IStoredSentPayment>> {
    this._checkInitialisedOrThrow();

    try {
      const filter: Record<string, unknown> = {};
      if (opts.walletAddressId != null) {
        filter['senderWalletAddressId'] = opts.walletAddressId;
      }
      if (opts.paymentIntentId != null) {
        filter['paymentIntentId'] = opts.paymentIntentId;
      }

      const page = await this._fetchPageDocs(
        this._sentPaymentCollection,
        filter,
        opts
      );

      return {
        ...page,
        items: page.items.map((payment) => ({
          id: payment.id,
          state: payment.state,
          createdAt: payment.createdAt,
          expiresAt: payment.expiresAt,
          paymentIntentId: payment.paymentIntentId,
          senderWalletAddress: payment.senderWalletAddress,
          senderWalletAddressId: payment.senderWalletAddressId,
          quoteId: payment.quoteId,
          grantId: payment.grantId,
          assetCode: payment.assetCode,
          assetScale: payment.assetScale,
          debitAmount: payment.debitAmount,
          receiveAmount: payment.receiveAmount,
          sentAmount: payment.sentAmount,
          ledgerTransferId: payment.ledgerTransferId,
          failReason: payment.failReason,
          cancelledAt: payment.cancelledAt,
          cancelReason: payment.cancelReason,
          metadata: payment.metadata,
          peerId: payment.peerId
        }))
      };
    } catch (err) {
      if (err instanceof InvalidArgument) throw err;
      this._logger.error(err);
      throw new Error(
        `Unable to fetch sent payments page - error: ${(err as Error).message}`
      );
    }
  }

  // Keyset pagination over (createdAt, id). The cursor is the last document's id.
  // Given the cursor, figure out where that document sits in the (createdAt, id)
  // ordering, then use that position as the starting point for the next page.
  private async _fetchPageDocs<T extends { id: string; createdAt: Date }>(
    collection: Collection<T>,
    filter: Record<string, unknown>,
    opts: {
      cursor?: string;
      limit: number;
      backwards: boolean;
      sortOrder?: SortOrder;
    }
  ): Promise<IPage<T>> {
    const { cursor, limit, backwards } = opts;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new InvalidArgument(
        `limit must be a positive integer, got ${limit}`
      );
    }
    const descending = (opts.sortOrder ?? DEFAULT_SORT_ORDER) === 'desc';

    let boundary: { id: string; createdAt: Date } | null = null;
    if (cursor != null) {
      boundary = (await collection.findOne({ id: cursor } as Filter<T>, {
        projection: { _id: 0, id: 1, createdAt: 1 }
      })) as { id: string; createdAt: Date } | null;
      if (!boundary) {
        throw new InvalidCursorError(`Unknown cursor: ${cursor}`);
      }
    }

    // Which way we walk the (createdAt, id) index from the cursor. Paging
    // forward through a descending list moves towards *older*
    const scanAscending = backwards === descending;

    const cmp = scanAscending ? '$gt' : '$lt';
    const range = boundary
      ? {
          $or: [
            { createdAt: { [cmp]: boundary.createdAt } },
            { createdAt: boundary.createdAt, id: { [cmp]: boundary.id } }
          ]
        }
      : {};

    const docs = (await collection
      .find({ ...filter, ...range } as Filter<T>)
      .sort(scanAscending ? { createdAt: 1, id: 1 } : { createdAt: -1, id: -1 })
      .limit(limit + 1)
      .toArray()) as unknown as T[];

    const hasMore = docs.length > limit;
    const items = docs.slice(0, limit);
    if (backwards) items.reverse();

    return {
      items,
      hasNextPage: backwards ? cursor != null : hasMore,
      hasPreviousPage: backwards ? hasMore : cursor != null
    };
  }

  async storeQuotes(
    quoteUpdates: { quoteIds: string[]; paymentIntent: IPaymentIntent }[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (quoteUpdates.length === 0) return;

    try {
      await this._paymentIntentCollection.bulkWrite(
        quoteUpdates.map((update) => ({
          updateOne: {
            filter: { id: update.paymentIntent.id },
            update: {
              $push: {
                quotes: {
                  $each: update.paymentIntent.quotes.filter((q) =>
                    update.quoteIds.includes(q.id)
                  )
                }
              }
            }
          }
        }))
      );
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store quotes for payment intents - error: ${(e as Error).message}`
      );
    }
  }

  async storeSentPayments(
    paymentUpdates: { paymentIds: string[]; paymentIntent: IPaymentIntent }[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (paymentUpdates.length === 0) return;

    const newPaymentEntities: IStoredSentPayment[] = [];

    for (const update of paymentUpdates) {
      const payments = update.paymentIntent.sentPayments.filter((p) =>
        update.paymentIds.includes(p.id)
      );

      for (const payment of payments) {
        newPaymentEntities.push({
          id: payment.id,
          state: payment.state,
          createdAt: payment.createdAt,
          expiresAt: payment.expiresAt,
          senderWalletAddress: payment.senderWalletAddress,
          senderWalletAddressId: payment.senderWalletAddressId,
          paymentIntentId: payment.paymentIntentId,
          assetCode: payment.assetCode,
          assetScale: payment.assetScale,
          debitAmount: payment.debitAmount,
          quoteId: payment.quoteId ? payment.quoteId : undefined,
          grantId: payment.grantId,
          receiveAmount: payment.receiveAmount,
          sentAmount: payment.sentAmount,
          metadata: payment.metadata,
          peerId: isRemoteSentPayment(payment) ? payment.peerId : undefined
        });
      }
    }
    try {
      await this._sentPaymentCollection.insertMany(newPaymentEntities);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store payments - error: ${(e as Error).message}`
      );
    }
  }

  async storeInboundPayments(
    inboundPaymentUpdates: {
      inboundPaymentIds: string[];
      paymentIntent: IPaymentIntent;
    }[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (inboundPaymentUpdates.length === 0) return;

    const newInboundPaymentEntities: IInboundPayment[] = [];

    for (const update of inboundPaymentUpdates) {
      const inboundPayments = update.paymentIntent.inboundPayments.filter(
        (rp) => update.inboundPaymentIds.includes(rp.id)
      );

      for (const inboundPayment of inboundPayments) {
        newInboundPaymentEntities.push({
          id: inboundPayment.id,
          state: inboundPayment.state,
          createdAt: inboundPayment.createdAt,
          paymentIntentId: inboundPayment.paymentIntentId,
          packetId: inboundPayment.packetId,
          peerId: inboundPayment.peerId,
          peerAssetCode: inboundPayment.peerAssetCode,
          peerAssetScale: inboundPayment.peerAssetScale,
          sourceAmount: inboundPayment.sourceAmount,
          receiveAmount: inboundPayment.receiveAmount,
          expiresAt: inboundPayment.expiresAt
        });
      }
    }

    try {
      await this._inboundPaymentCollection.insertMany(
        newInboundPaymentEntities
      );
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store inbound payments - error: ${(e as Error).message}`
      );
    }
  }

  async storeAcceptedInboundPayments(
    inboundPaymentUpdates: {
      inboundPayments: {
        id: string;
        state: InboundPaymentState;
        ledgerTransferId: string;
      }[];
    }[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (inboundPaymentUpdates.length === 0) return;

    try {
      const inboundPaymentWrites = inboundPaymentUpdates.flatMap((update) =>
        update.inboundPayments.map((inboundPayment) => ({
          updateOne: {
            filter: { id: inboundPayment.id },
            update: {
              $set: {
                state: inboundPayment.state,
                ledgerTransferId: inboundPayment.ledgerTransferId
              }
            }
          }
        }))
      );

      await this._inboundPaymentCollection.bulkWrite(inboundPaymentWrites);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store accepted inbound payments - error: ${(e as Error).message}`
      );
    }
  }

  async storeFailedInboundPayments(
    inboundPaymentUpdates: {
      inboundPayments: {
        id: string;
        state: InboundPaymentState;
        failReason?: string;
      }[];
    }[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (inboundPaymentUpdates.length === 0) return;

    try {
      const inboundPaymentWrites = inboundPaymentUpdates.flatMap((update) =>
        update.inboundPayments.map((inboundPayment) => ({
          updateOne: {
            filter: { id: inboundPayment.id },
            update: {
              $set: {
                state: inboundPayment.state,
                ...(inboundPayment.failReason
                  ? { failReason: inboundPayment.failReason }
                  : {})
              }
            }
          }
        }))
      );

      await this._inboundPaymentCollection.bulkWrite(inboundPaymentWrites);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store failed inbound payments - error: ${(e as Error).message}`
      );
    }
  }

  async storeFulfillableInboundPayments(
    inboundPaymentUpdates: {
      inboundPayments: { id: string; state: InboundPaymentState }[];
    }[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (inboundPaymentUpdates.length === 0) return;

    try {
      const inboundPaymentWrites = inboundPaymentUpdates.flatMap((update) =>
        update.inboundPayments.map((inboundPayment) => ({
          updateOne: {
            filter: { id: inboundPayment.id },
            update: {
              $set: {
                state: inboundPayment.state
              }
            }
          }
        }))
      );

      await this._inboundPaymentCollection.bulkWrite(inboundPaymentWrites);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store fulfillable inbound payments - error: ${(e as Error).message}`
      );
    }
  }

  async storeFinalizedInboundPayments(
    inboundPaymentUpdates: {
      paymentIntent: {
        id: string;
        receivedAmount: bigint;
        state: PaymentIntentState;
      };
      inboundPayments: { id: string; state: InboundPaymentState }[];
    }[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (inboundPaymentUpdates.length === 0) return;

    try {
      const intentWrites = inboundPaymentUpdates.map((update) => ({
        updateOne: {
          filter: { id: update.paymentIntent.id },
          update: {
            $set: {
              state: update.paymentIntent.state,
              receivedAmount: update.paymentIntent.receivedAmount
            }
          }
        }
      }));

      const inboundPaymentWrites = inboundPaymentUpdates.flatMap((update) =>
        update.inboundPayments.map((inboundPayment) => ({
          updateOne: {
            filter: { id: inboundPayment.id },
            update: { $set: { state: inboundPayment.state } }
          }
        }))
      );

      await Promise.all([
        this._paymentIntentCollection.bulkWrite(intentWrites),
        this._inboundPaymentCollection.bulkWrite(inboundPaymentWrites)
      ]);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store finalized inbound payments - error: ${(e as Error).message}`
      );
    }
  }

  async storeFinalizedRemoteQuotes(
    updates: FinalizedRemoteQuoteUpdate[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (updates.length === 0) return;

    try {
      await this._paymentIntentCollection.bulkWrite(
        updates.map((u) => ({
          updateOne: {
            filter: { id: u.paymentIntentId },
            update: {
              $set:
                u.state === 'COMPLETED'
                  ? {
                      'quotes.$[q].state': 'COMPLETED',
                      'quotes.$[q].debitAmount': u.debitAmount,
                      'quotes.$[q].receiveAmount': u.receiveAmount,
                      'quotes.$[q].exchangeRate': u.exchangeRate,
                      'quotes.$[q].expiresAt': u.expiresAt
                    }
                  : {
                      'quotes.$[q].state': 'FAILED',
                      'quotes.$[q].errorName': u.errorName,
                      'quotes.$[q].message': u.message
                    }
            },
            arrayFilters: [{ 'q.id': u.quoteId }]
          }
        }))
      );
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to finalize remote quotes - error: ${(e as Error).message}`
      );
    }
  }

  async storeCompletedLocalPayments(
    paymentUpdates: {
      paymentIntent: {
        id: string;
        receivedAmount: bigint;
        state: PaymentIntentState;
      };
      sentPayments: {
        id: string;
        state: SentPaymentState;
        sentAmount: bigint;
      }[];
    }[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (paymentUpdates.length === 0) return;

    try {
      const intentWrites = paymentUpdates.map((update) => ({
        updateOne: {
          filter: { id: update.paymentIntent.id },
          update: {
            $set: {
              state: update.paymentIntent.state,
              receivedAmount: update.paymentIntent.receivedAmount
            }
          }
        }
      }));

      const paymentWrites = paymentUpdates.flatMap((update) =>
        update.sentPayments
          .filter((p) => update.sentPayments.map((p) => p.id).includes(p.id))
          .map((payment) => ({
            updateOne: {
              filter: { id: payment.id },
              update: {
                $set: {
                  state: payment.state,
                  sentAmount: payment.sentAmount
                }
              }
            }
          }))
      );

      await Promise.all([
        this._paymentIntentCollection.bulkWrite(intentWrites),
        this._sentPaymentCollection.bulkWrite(paymentWrites)
      ]);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store payments - error: ${(e as Error).message}`
      );
    }
  }

  async storeApprovedRemotePayments(
    paymentUpdates: {
      sentPayments: { id: string; state: SentPaymentState }[];
    }[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (paymentUpdates.length === 0) return;

    try {
      const paymentWrites = paymentUpdates.flatMap((update) =>
        update.sentPayments.map((payment) => ({
          updateOne: {
            filter: { id: payment.id },
            update: { $set: { state: payment.state } }
          }
        }))
      );

      await this._sentPaymentCollection.bulkWrite(paymentWrites);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store approved remote payments - error: ${(e as Error).message}`
      );
    }
  }

  async storeSendingRemotePayments(
    paymentUpdates: {
      sentPayments: {
        id: string;
        state: SentPaymentState;
        ledgerTransferId: string;
      }[];
    }[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (paymentUpdates.length === 0) return;

    try {
      const paymentWrites = paymentUpdates.flatMap((update) =>
        update.sentPayments.map((payment) => ({
          updateOne: {
            filter: { id: payment.id },
            update: {
              $set: {
                state: payment.state,
                ledgerTransferId: payment.ledgerTransferId
              }
            }
          }
        }))
      );

      await this._sentPaymentCollection.bulkWrite(paymentWrites);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store sending remote payments - error: ${(e as Error).message}`
      );
    }
  }

  async storeFailedRemotePayments(
    paymentUpdates: {
      sentPayments: {
        id: string;
        state: SentPaymentState;
        failReason?: string;
      }[];
    }[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (paymentUpdates.length === 0) return;

    try {
      const paymentWrites = paymentUpdates.flatMap((update) =>
        update.sentPayments.map((payment) => ({
          updateOne: {
            filter: { id: payment.id },
            update: {
              $set: {
                state: payment.state,
                ...(payment.failReason
                  ? { failReason: payment.failReason }
                  : {})
              }
            }
          }
        }))
      );

      await this._sentPaymentCollection.bulkWrite(paymentWrites);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store failed remote payments - error: ${(e as Error).message}`
      );
    }
  }

  async storeConfirmedRemotePayments(
    paymentUpdates: {
      sentPayments: { id: string; state: SentPaymentState }[];
    }[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (paymentUpdates.length === 0) return;

    try {
      const paymentWrites = paymentUpdates.flatMap((update) =>
        update.sentPayments.map((payment) => ({
          updateOne: {
            filter: { id: payment.id },
            update: { $set: { state: payment.state } }
          }
        }))
      );

      await this._sentPaymentCollection.bulkWrite(paymentWrites);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store confirmed remote payments - error: ${(e as Error).message}`
      );
    }
  }

  async storeRejectedRemotePayments(
    paymentUpdates: {
      sentPayments: {
        id: string;
        state: SentPaymentState;
        failReason?: string;
      }[];
    }[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (paymentUpdates.length === 0) return;

    try {
      const paymentWrites = paymentUpdates.flatMap((update) =>
        update.sentPayments.map((payment) => ({
          updateOne: {
            filter: { id: payment.id },
            update: {
              $set: {
                state: payment.state,
                ...(payment.failReason
                  ? { failReason: payment.failReason }
                  : {})
              }
            }
          }
        }))
      );

      await this._sentPaymentCollection.bulkWrite(paymentWrites);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store rejected remote payments - error: ${(e as Error).message}`
      );
    }
  }

  async storeCompletedRemotePayments(
    paymentUpdates: {
      paymentIntent: {
        id: string;
        receivedAmount: bigint;
        state: PaymentIntentState;
      };
      sentPayments: {
        id: string;
        state: SentPaymentState;
        sentAmount: bigint;
      }[];
    }[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (paymentUpdates.length === 0) return;

    try {
      const intentWrites = paymentUpdates.map((update) => ({
        updateOne: {
          filter: { id: update.paymentIntent.id },
          update: {
            $set: {
              state: update.paymentIntent.state,
              receivedAmount: update.paymentIntent.receivedAmount
            }
          }
        }
      }));

      const paymentWrites = paymentUpdates.flatMap((update) =>
        update.sentPayments.map((payment) => ({
          updateOne: {
            filter: { id: payment.id },
            update: {
              $set: {
                state: payment.state,
                sentAmount: payment.sentAmount
              }
            }
          }
        }))
      );

      await Promise.all([
        this._paymentIntentCollection.bulkWrite(intentWrites),
        this._sentPaymentCollection.bulkWrite(paymentWrites)
      ]);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store completed remote payments - error: ${(e as Error).message}`
      );
    }
  }

  async storeCancelledPayments(
    paymentUpdates: {
      sentPayments: {
        id: string;
        state: SentPaymentState;
        cancelledAt: Date;
        cancelReason?: string;
      }[];
    }[]
  ): Promise<void> {
    this._checkInitialisedOrThrow();

    if (paymentUpdates.length === 0) return;

    try {
      const paymentWrites = paymentUpdates.flatMap((update) =>
        update.sentPayments
          .filter((p) => update.sentPayments.map((p) => p.id).includes(p.id))
          .map((payment) => ({
            updateOne: {
              filter: { id: payment.id },
              update: {
                $set: {
                  state: payment.state,
                  cancelledAt: payment.cancelledAt,
                  ...(payment.cancelReason
                    ? { cancelReason: payment.cancelReason }
                    : {})
                }
              }
            }
          }))
      );

      await Promise.all([this._sentPaymentCollection.bulkWrite(paymentWrites)]);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to store payments - error: ${(e as Error).message}`
      );
    }
  }

  async getExpiredPaymentIntentIds(limit: number): Promise<string[]> {
    this._checkInitialisedOrThrow();

    try {
      const expiresAt = new Date(Date.now() + 30000);
      const paymentIntents = await this._paymentIntentCollection
        .find({
          // TODO: add states that can expire
          expiresAt: { $lt: expiresAt }
        })
        .limit(limit)
        .toArray();

      return paymentIntents.map((paymentIntent) => paymentIntent.id);
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to get expired payment intents - error: ${(e as Error).message}`
      );
    }
  }

  async getExpiredPayments(
    limit: number
  ): Promise<{ paymentId: string; paymentIntentId: string }[]> {
    this._checkInitialisedOrThrow();

    try {
      const expiresAt = new Date(Date.now() + 30000);
      const payments = await this._sentPaymentCollection
        .find({
          // TODO: add states that can expire
          expiresAt: { $lt: expiresAt }
        })
        .limit(limit)
        .toArray();

      return payments.map((payment) => ({
        paymentId: payment.id,
        paymentIntentId: payment.paymentIntentId
      }));
    } catch (e) {
      this._logger.error(e);
      throw new Error(
        `Unable to get expired payments - error: ${(e as Error).message}`
      );
    }
  }
}
