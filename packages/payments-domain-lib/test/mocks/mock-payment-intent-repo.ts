import {
  FinalizedRemoteQuoteUpdate,
  IPaymentIntent,
  IPaymentIntentRepository,
  PaymentIntentState,
  PaymentState
} from '../../src/payment-intent/interfaces';

export class MockPaymentIntentRepo implements IPaymentIntentRepository {
  private _store: Map<string, IPaymentIntent> = new Map();

  async storeMany(payments: IPaymentIntent[]): Promise<void> {
    for (const p of payments) {
      this._store.set(p.id, p);
    }
  }

  async fetchByIds(ids: string[]): Promise<Omit<IPaymentIntent, 'payments'>[]> {
    return ids.flatMap((id) => {
      const p = this._store.get(id);
      if (!p) return [];
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/naming-convention
      const { payments: _payments, ...rest } = p;
      return [rest];
    });
  }

  async fetchByIdsWithPayments(ids: string[]): Promise<IPaymentIntent[]> {
    const results: IPaymentIntent[] = [];
    for (const id of ids) {
      const p = this._store.get(id);
      if (p) results.push(p);
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

  async storeQuotes(
    quoteUpdates: { quoteIds: string[]; paymentIntent: IPaymentIntent }[]
  ): Promise<void> {
    for (const update of quoteUpdates) {
      this._store.set(update.paymentIntent.id, update.paymentIntent);
    }
  }

  async storePayments(
    paymentUpdates: { paymentIds: string[]; paymentIntent: IPaymentIntent }[]
  ): Promise<void> {
    for (const update of paymentUpdates) {
      this._store.set(update.paymentIntent.id, update.paymentIntent);
    }
  }

  async storeCompletedLocalPayments(
    paymentUpdates: {
      paymentIntent: {
        id: string;
        receivedAmount: bigint;
        state: PaymentIntentState;
      };
      payments: { id: string; state: PaymentState; sentAmount: bigint }[];
    }[]
  ): Promise<void> {
    for (const update of paymentUpdates) {
      const paymentIntent = this._store.get(update.paymentIntent.id);
      if (!paymentIntent) {
        throw new Error('Could not find paymentIntent in store');
      }

      paymentIntent.state = update.paymentIntent.state;
      paymentIntent.receivedAmount = update.paymentIntent.receivedAmount;

      for (const payment of update.payments) {
        const foundPayment = paymentIntent.payments.find(
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
