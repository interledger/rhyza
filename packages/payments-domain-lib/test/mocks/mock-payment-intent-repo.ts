import {
  FinalizedRemoteQuoteUpdate,
  IPaymentPageOpts,
  IPaymentIntent,
  IPaymentIntentRepository,
  ISentPayment,
  isRemoteSentPayment,
  PaymentIntentState,
  SentPaymentState,
  InboundPaymentState
} from '../../src/payment-intent/interfaces';
import {
  DEFAULT_SORT_ORDER,
  InvalidArgument,
  InvalidCursorError,
  IPage,
  SortOrder
} from 'common-types-lib';

export class MockPaymentIntentRepo implements IPaymentIntentRepository {
  private _store: Map<string, IPaymentIntent> = new Map();

  async storeMany(payments: IPaymentIntent[]): Promise<void> {
    for (const p of payments) {
      this._store.set(p.id, p);
    }
  }

  async storeCompletedPaymentIntents(
    paymentIntents: { id: string; state: PaymentIntentState }[]
  ): Promise<void> {
    for (const update of paymentIntents) {
      const paymentIntent = this._store.get(update.id);
      if (!paymentIntent) {
        throw new Error('Could not find paymentIntent in store');
      }
      paymentIntent.state = update.state;
    }
  }

  async fetchByIds(
    ids: string[]
  ): Promise<Omit<IPaymentIntent, 'sentPayments' | 'inboundPayments'>[]> {
    return ids.flatMap((id) => {
      const p = this._store.get(id);
      if (!p) return [];
      const { sentPayments, inboundPayments, ...rest } = p;
      void sentPayments;
      void inboundPayments;
      return [rest];
    });
  }

  async fetchByIdsWithPayments(ids: string[]): Promise<IPaymentIntent[]> {
    const results: IPaymentIntent[] = [];
    for (const id of ids) {
      const p = this._store.get(id);
      if (!p) continue;
      results.push({
        ...p,
        quotes: p.quotes.map((quote) => ({ ...quote })),
        sentPayments: p.sentPayments.map((payment) => ({ ...payment })),
        inboundPayments: p.inboundPayments.map((inboundPayment) => ({
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
          ledgerTransferId: inboundPayment.ledgerTransferId,
          failReason: inboundPayment.failReason,
          expiresAt: inboundPayment.expiresAt
        }))
      });
    }
    return results;
  }

  async fetchIdsByRemoteUrls(
    urls: string[]
  ): Promise<Array<{ id: string; remoteUrl: string }>> {
    const results: Array<{ id: string; remoteUrl: string }> = [];
    for (const p of this._store.values()) {
      if (p.remoteUrl && urls.includes(p.remoteUrl)) {
        results.push({ id: p.id, remoteUrl: p.remoteUrl });
      }
    }
    return results;
  }

  async fetchPaymentIntentsPage(
    opts: IPaymentPageOpts
  ): Promise<IPage<Omit<IPaymentIntent, 'sentPayments' | 'inboundPayments'>>> {
    const all = this.getAll();
    const filtered =
      opts.walletAddressId == null
        ? all
        : all.filter((p) => p.receiverWalletAddressId === opts.walletAddressId);
    const page = this._page(all, filtered, opts);
    return {
      ...page,
      items: page.items.map((p) => {
        const { sentPayments, inboundPayments, ...rest } = p;
        void sentPayments;
        void inboundPayments;
        return rest;
      })
    };
  }

  async fetchSentPaymentsPage(
    opts: IPaymentPageOpts & { paymentIntentId?: string }
  ): Promise<IPage<ISentPayment>> {
    const all = this.getAll().flatMap((intent) => intent.sentPayments);
    const filtered = all.filter(
      (p) =>
        (opts.walletAddressId == null ||
          p.senderWalletAddressId === opts.walletAddressId) &&
        (opts.paymentIntentId == null ||
          p.paymentIntentId === opts.paymentIntentId)
    );
    return this._page(all, filtered, opts);
  }

  // Keyset pagination over (createdAt, id) — mirrors the Mongo implementation.
  // The cursor is resolved against the unfiltered collection, like the
  // Mongo boundary findOne.
  private _page<T extends { id: string; createdAt: Date }>(
    all: T[],
    filtered: T[],
    opts: {
      cursor?: string;
      limit: number;
      backwards: boolean;
      sortOrder?: SortOrder;
    }
  ): IPage<T> {
    if (!Number.isInteger(opts.limit) || opts.limit < 1) {
      throw new InvalidArgument(
        `limit must be a positive integer, got ${opts.limit}`
      );
    }
    const cmp = (a: T, b: T) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

    const descending = (opts.sortOrder ?? DEFAULT_SORT_ORDER) === 'desc';
    // Mirrors the Mongo implementation: paging forward through a descending
    // list walks the (createdAt, id) index towards older documents.
    const scanAscending = opts.backwards === descending;

    let boundary: T | undefined;
    if (opts.cursor != null) {
      boundary = all.find((item) => item.id === opts.cursor);
      if (!boundary) {
        throw new InvalidCursorError(`Unknown cursor: ${opts.cursor}`);
      }
    }

    const inRange = boundary
      ? filtered.filter((item) =>
          scanAscending ? cmp(item, boundary) > 0 : cmp(item, boundary) < 0
        )
      : filtered;

    const sorted = [...inRange].sort(cmp);
    if (!scanAscending) sorted.reverse();

    const hasMore = sorted.length > opts.limit;
    const items = sorted.slice(0, opts.limit);
    if (opts.backwards) items.reverse();

    return {
      items,
      hasNextPage: opts.backwards ? opts.cursor != null : hasMore,
      hasPreviousPage: opts.backwards ? hasMore : opts.cursor != null
    };
  }

  async storeQuotes(
    quoteUpdates: { quoteIds: string[]; paymentIntent: IPaymentIntent }[]
  ): Promise<void> {
    for (const update of quoteUpdates) {
      this._store.set(update.paymentIntent.id, update.paymentIntent);
    }
  }

  async storeSentPayments(
    paymentUpdates: { paymentIds: string[]; paymentIntent: IPaymentIntent }[]
  ): Promise<void> {
    for (const update of paymentUpdates) {
      this._store.set(update.paymentIntent.id, update.paymentIntent);
    }
  }

  async storeInboundPayments(
    inboundPaymentUpdates: {
      inboundPaymentIds: string[];
      paymentIntent: IPaymentIntent;
    }[]
  ): Promise<void> {
    for (const update of inboundPaymentUpdates) {
      this._store.set(update.paymentIntent.id, update.paymentIntent);
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
    for (const update of inboundPaymentUpdates) {
      for (const inboundPayment of update.inboundPayments) {
        const found = this.getAll()
          .flatMap((intent) => intent.inboundPayments)
          .find((rp) => rp.id === inboundPayment.id);
        if (!found) {
          throw new Error('Could not find inbound payment in store');
        }
        found.state = inboundPayment.state;
        found.ledgerTransferId = inboundPayment.ledgerTransferId;
      }
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
    for (const update of inboundPaymentUpdates) {
      for (const inboundPayment of update.inboundPayments) {
        const found = this.getAll()
          .flatMap((intent) => intent.inboundPayments)
          .find((rp) => rp.id === inboundPayment.id);
        if (!found) {
          throw new Error('Could not find inbound payment in store');
        }
        found.state = inboundPayment.state;
        if (inboundPayment.failReason) {
          found.failReason = inboundPayment.failReason;
        }
      }
    }
  }

  async storeFulfillableInboundPayments(
    inboundPaymentUpdates: {
      inboundPayments: { id: string; state: InboundPaymentState }[];
    }[]
  ): Promise<void> {
    for (const update of inboundPaymentUpdates) {
      for (const inboundPayment of update.inboundPayments) {
        const found = this.getAll()
          .flatMap((intent) => intent.inboundPayments)
          .find((rp) => rp.id === inboundPayment.id);
        if (!found) {
          throw new Error('Could not find inbound payment in store');
        }
        found.state = inboundPayment.state;
      }
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
    for (const update of inboundPaymentUpdates) {
      const paymentIntent = this._store.get(update.paymentIntent.id);
      if (!paymentIntent) {
        throw new Error('Could not find paymentIntent in store');
      }

      paymentIntent.state = update.paymentIntent.state;
      paymentIntent.receivedAmount = update.paymentIntent.receivedAmount;

      for (const inboundPayment of update.inboundPayments) {
        const found = paymentIntent.inboundPayments.find(
          (rp) => rp.id === inboundPayment.id
        );
        if (!found) {
          throw new Error('Could not find inbound payment in store');
        }
        found.state = inboundPayment.state;
      }
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
    for (const update of paymentUpdates) {
      const paymentIntent = this._store.get(update.paymentIntent.id);
      if (!paymentIntent) {
        throw new Error('Could not find paymentIntent in store');
      }

      paymentIntent.state = update.paymentIntent.state;
      paymentIntent.receivedAmount = update.paymentIntent.receivedAmount;

      for (const payment of update.sentPayments) {
        const foundPayment = paymentIntent.sentPayments.find(
          (p) => p.id === payment.id
        );
        if (!foundPayment) {
          throw new Error('Could not find paymentIntent in store');
        }

        foundPayment.state = payment.state;
        foundPayment.sentAmount = payment.sentAmount;
      }
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
    for (const update of paymentUpdates) {
      for (const payment of update.sentPayments) {
        const foundPayment = this.getAll()
          .flatMap((intent) => intent.sentPayments)
          .find((p) => p.id === payment.id);
        if (!foundPayment) {
          throw new Error('Could not find payment in store');
        }

        foundPayment.state = payment.state;
        foundPayment.cancelledAt = payment.cancelledAt;
        if (payment.cancelReason) {
          foundPayment.cancelReason = payment.cancelReason;
        } else {
          delete foundPayment.cancelReason;
        }
      }
    }
  }

  async storeApprovedRemotePayments(
    paymentUpdates: {
      sentPayments: { id: string; state: SentPaymentState }[];
    }[]
  ): Promise<void> {
    for (const update of paymentUpdates) {
      for (const payment of update.sentPayments) {
        const foundPayment = this.getAll()
          .flatMap((intent) => intent.sentPayments)
          .find((p) => p.id === payment.id);
        if (!foundPayment) {
          throw new Error('Could not find payment in store');
        }
        foundPayment.state = payment.state;
      }
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
    for (const update of paymentUpdates) {
      for (const payment of update.sentPayments) {
        const foundPayment = this.getAll()
          .flatMap((intent) => intent.sentPayments)
          .find((p) => p.id === payment.id);
        if (!foundPayment) {
          throw new Error('Could not find payment in store');
        }
        foundPayment.state = payment.state;
        if (isRemoteSentPayment(foundPayment)) {
          foundPayment.ledgerTransferId = payment.ledgerTransferId;
        }
      }
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
    for (const update of paymentUpdates) {
      for (const payment of update.sentPayments) {
        const foundPayment = this.getAll()
          .flatMap((intent) => intent.sentPayments)
          .find((p) => p.id === payment.id);
        if (!foundPayment) {
          throw new Error('Could not find payment in store');
        }
        foundPayment.state = payment.state;
        if (payment.failReason && isRemoteSentPayment(foundPayment)) {
          foundPayment.failReason = payment.failReason;
        }
      }
    }
  }

  async storeConfirmedRemotePayments(
    paymentUpdates: {
      sentPayments: { id: string; state: SentPaymentState }[];
    }[]
  ): Promise<void> {
    for (const update of paymentUpdates) {
      for (const payment of update.sentPayments) {
        const foundPayment = this.getAll()
          .flatMap((intent) => intent.sentPayments)
          .find((p) => p.id === payment.id);
        if (!foundPayment) {
          throw new Error('Could not find payment in store');
        }
        foundPayment.state = payment.state;
      }
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
    for (const update of paymentUpdates) {
      for (const payment of update.sentPayments) {
        const foundPayment = this.getAll()
          .flatMap((intent) => intent.sentPayments)
          .find((p) => p.id === payment.id);
        if (!foundPayment) {
          throw new Error('Could not find payment in store');
        }
        foundPayment.state = payment.state;
        if (payment.failReason && isRemoteSentPayment(foundPayment)) {
          foundPayment.failReason = payment.failReason;
        }
      }
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
    for (const update of paymentUpdates) {
      const paymentIntent = this._store.get(update.paymentIntent.id);
      if (!paymentIntent) {
        throw new Error('Could not find paymentIntent in store');
      }

      paymentIntent.state = update.paymentIntent.state;
      paymentIntent.receivedAmount = update.paymentIntent.receivedAmount;

      for (const payment of update.sentPayments) {
        const foundPayment = paymentIntent.sentPayments.find(
          (p) => p.id === payment.id
        );
        if (!foundPayment) {
          throw new Error('Could not find payment in store');
        }
        foundPayment.state = payment.state;
        foundPayment.sentAmount = payment.sentAmount;
      }
    }
  }

  async storeFinalizedRemoteQuotes(
    updates: FinalizedRemoteQuoteUpdate[]
  ): Promise<void> {
    for (const update of updates) {
      const paymentIntent = this._store.get(update.paymentIntentId);
      if (!paymentIntent) {
        throw new Error('Could not find paymentIntent in store');
      }

      const quote = paymentIntent.quotes.find((q) => q.id === update.quoteId);
      if (!quote) {
        throw new Error('Could not find quote in store');
      }

      if (update.state === 'COMPLETED') {
        Object.assign(quote, {
          state: 'COMPLETED',
          debitAmount: update.debitAmount,
          receiveAmount: update.receiveAmount,
          exchangeRate: update.exchangeRate,
          expiresAt: update.expiresAt
        });
      } else {
        Object.assign(quote, {
          state: 'FAILED',
          errorName: update.errorName,
          message: update.message
        });
      }
    }
  }

  getAll(): IPaymentIntent[] {
    return [...this._store.values()];
  }
}
