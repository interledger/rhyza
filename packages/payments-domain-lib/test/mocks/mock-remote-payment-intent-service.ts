import {
  IRemotePaymentIntentService,
  IRemotePaymentIntentDetails
} from '../../src/payment-intent/interfaces';

export class MockRemotePaymentIntentService
  implements IRemotePaymentIntentService
{
  async fetchIncomingPayment(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _url: string
  ): Promise<IRemotePaymentIntentDetails> {
    throw new Error('Not implemented');
  }
}
