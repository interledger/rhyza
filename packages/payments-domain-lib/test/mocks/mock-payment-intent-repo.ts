import {
  IPaymentIntent,
  IPaymentIntentRepository
} from '../../src/payment-intent/interfaces';

export class MockPaymentIntentRepo implements IPaymentIntentRepository {
  private _store: Map<string, IPaymentIntent> = new Map();

  async storeMany(payments: IPaymentIntent[]): Promise<void> {
    for (const p of payments) {
      this._store.set(p.id, p);
    }
  }

  async fetchByIds(ids: string[]): Promise<IPaymentIntent[]> {
    const results: IPaymentIntent[] = [];
    for (const id of ids) {
      const p = this._store.get(id);
      if (p) results.push(p);
    }
    return results;
  }

  getAll(): IPaymentIntent[] {
    return [...this._store.values()];
  }
}
