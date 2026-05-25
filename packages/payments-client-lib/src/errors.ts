export class RemoteQuotingNotConfiguredError extends Error {
  constructor() {
    super(
      'openPaymentsUrl is required for remote quotes — pass it to the PaymentsClient constructor'
    );
  }
}

export class PaymentIntentNotFoundError extends Error {
  constructor(id: string) {
    super(`Payment intent '${id}' not found`);
  }
}
