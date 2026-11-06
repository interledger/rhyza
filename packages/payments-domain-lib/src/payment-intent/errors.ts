import {
  AlreadyExists,
  FailedPrecondition,
  Internal,
  InvalidArgument,
  NotFound
} from 'common-types-lib';

export class CannotCreateDuplicatePaymentIntentError extends AlreadyExists {
  constructor(message?: string) {
    super(message);
    this.name = 'CannotCreateDuplicatePaymentIntentError';
  }
}

export class InvalidPaymentIntentError extends InvalidArgument {
  constructor(message?: string) {
    super(message);
    this.name = 'InvalidPaymentIntentError';
  }
}

export class WalletAddressNotFoundError extends NotFound {
  constructor(message?: string) {
    super(message);
    this.name = 'WalletAddressNotFoundError';
  }
}

export class WalletAddressInactiveError extends FailedPrecondition {
  constructor(message?: string) {
    super(message);
    this.name = 'WalletAddressInactiveError';
  }
}

export class InvalidPaymentIntentExpiryError extends InvalidArgument {
  constructor(message?: string) {
    super(message);
    this.name = 'InvalidPaymentIntentExpiryError';
  }
}

export class PaymentIntentNotFoundError extends NotFound {
  constructor(message?: string) {
    super(message);
    this.name = 'PaymentIntentNotFoundError';
  }
}

export class PaymentIntentInvalidState extends FailedPrecondition {
  constructor(message?: string) {
    super(message);
    this.name = 'PaymentIntentInvalidState';
  }
}

export class PaymentIntentExpired extends FailedPrecondition {
  constructor(message?: string) {
    super(message);
    this.name = 'PaymentIntentExpired';
  }
}

export class RatesError extends Internal {
  constructor(message?: string) {
    super(message);
    this.name = 'RatesError';
  }
}

export class InvalidQuoteAmountError extends InvalidArgument {
  constructor(message?: string) {
    super(message);
    this.name = 'InvalidQuoteAmountError';
  }
}

export class InvalidQuoteIdError extends NotFound {
  constructor(message?: string) {
    super(message);
    this.name = 'InvalidQuoteIdError';
  }
}

export class InvalidQuoteStateError extends FailedPrecondition {
  constructor(message?: string) {
    super(message);
    this.name = 'InvalidQuoteStateError';
  }
}

export class QuoteExpiredError extends FailedPrecondition {
  constructor(message?: string) {
    super(message);
    this.name = 'QuoteExpiredError';
  }
}

export class InvalidPaymentIdError extends InvalidArgument {
  constructor(message?: string) {
    super(message);
    this.name = 'InvalidPaymentIdError';
  }
}

export class PaymentNotFoundError extends NotFound {
  constructor(message?: string) {
    super(message);
    this.name = 'PaymentNotFoundError';
  }
}

export class PaymentInvalidStateError extends FailedPrecondition {
  constructor(message?: string) {
    super(message);
    this.name = 'PaymentInvalidStateError';
  }
}

export class InvalidPaymentAmountError extends InvalidArgument {
  constructor(message?: string) {
    super(message);
    this.name = 'InvalidPaymentAmountError';
  }
}

export class MissingDestinationIlpAddressError extends FailedPrecondition {
  constructor(message?: string) {
    super(message);
    this.name = 'MissingDestinationIlpAddressError';
  }
}

export class PeerNotFoundError extends NotFound {
  constructor(message?: string) {
    super(message);
    this.name = 'PeerNotFoundError';
  }
}

export class QuoteReceiveAssetMismatchError extends FailedPrecondition {
  constructor(message?: string) {
    super(message);
    this.name = 'QuoteReceiveAssetMismatchError';
  }
}

export class MissingFxRateError extends FailedPrecondition {
  constructor(message?: string) {
    super(message);
    this.name = 'MissingFxRateError';
  }
}
