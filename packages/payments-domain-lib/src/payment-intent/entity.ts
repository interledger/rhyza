import {
  InvalidPaymentAmountError,
  InvalidPaymentIdError,
  InvalidPaymentIntentError,
  InvalidPaymentIntentExpiryError,
  InvalidQuoteAmountError,
  InvalidQuoteIdError,
  InvalidQuoteStateError,
  PaymentIntentExpired,
  PaymentIntentInvalidState,
  PaymentInvalidStateError,
  PaymentNotFoundError,
  QuoteExpiredError
} from './errors';
import {
  IBaseQuote,
  ICompletedQuote,
  IPendingQuote,
  IPaymentIntent,
  IQuote,
  PaymentIntentDestination,
  PaymentIntentState,
  PaymentState,
  QuoteState
} from './interfaces';

const MAX_PAYMENT_INTENT_EXPIRY_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const QUOTE_EXPIRY_MS = 1000 * 60 * 10;

type QuoteData =
  | { state: 'PENDING'; debitAmount?: bigint; receiveAmount?: bigint }
  | {
      state: 'COMPLETED';
      debitAmount: bigint;
      receiveAmount: bigint;
      exchangeRate: number;
      expiresAt: Date;
    }
  | { state: 'FAILED'; errorName: string; message: string };

class Quote implements IBaseQuote {
  private _id: string;
  private _senderWalletAddress: string;
  private _senderWalletAddressId: string;
  private _data: QuoteData;

  private constructor(
    id: string,
    senderWalletAddress: string,
    senderWalletAddressId: string,
    data: QuoteData
  ) {
    this._id = id;
    this._senderWalletAddress = senderWalletAddress;
    this._senderWalletAddressId = senderWalletAddressId;
    this._data = data;
  }

  static createPending(
    id: string,
    senderWalletAddress: string,
    senderWalletAddressId: string,
    debitAmount?: bigint,
    receiveAmount?: bigint
  ): Quote {
    return new Quote(id, senderWalletAddress, senderWalletAddressId, {
      state: 'PENDING',
      debitAmount,
      receiveAmount
    });
  }

  static fromObject(obj: IQuote): Quote {
    if (obj.state === 'COMPLETED') {
      return new Quote(
        obj.id,
        obj.senderWalletAddress,
        obj.senderWalletAddressId,
        {
          state: 'COMPLETED',
          debitAmount: obj.debitAmount,
          receiveAmount: obj.receiveAmount,
          exchangeRate: obj.exchangeRate,
          expiresAt: obj.expiresAt
        }
      );
    } else if (obj.state === 'FAILED') {
      return new Quote(
        obj.id,
        obj.senderWalletAddress,
        obj.senderWalletAddressId,
        {
          state: 'FAILED',
          errorName: obj.errorName,
          message: obj.message
        }
      );
    } else {
      return new Quote(
        obj.id,
        obj.senderWalletAddress,
        obj.senderWalletAddressId,
        {
          state: 'PENDING',
          debitAmount: obj.debitAmount,
          receiveAmount: obj.receiveAmount
        }
      );
    }
  }

  complete(args: {
    debitAmount: bigint;
    receiveAmount: bigint;
    exchangeRate: number;
    paymentIntentExpiresAt: Date;
  }): void {
    if (this._data.state !== 'PENDING') {
      throw new InvalidQuoteStateError(
        `Quote ${this._id} is not in PENDING state, cannot complete`
      );
    }
    const { debitAmount, receiveAmount, exchangeRate, paymentIntentExpiresAt } =
      args;
    this._data = {
      state: 'COMPLETED',
      debitAmount,
      receiveAmount,
      exchangeRate,
      expiresAt: new Date(
        Math.min(paymentIntentExpiresAt.getTime(), Date.now() + QUOTE_EXPIRY_MS)
      )
    };
  }

  fail(args: { errorName: string; message: string }): void {
    if (this._data.state !== 'PENDING') {
      throw new InvalidQuoteStateError(
        `Quote ${this._id} is not in PENDING state, cannot fail`
      );
    }
    this._data = {
      state: 'FAILED',
      errorName: args.errorName,
      message: args.message
    };
  }

  toObject(): IQuote {
    const base = {
      id: this._id,
      senderWalletAddress: this._senderWalletAddress,
      senderWalletAddressId: this._senderWalletAddressId
    };
    if (this._data.state === 'COMPLETED') {
      const { debitAmount, receiveAmount, exchangeRate, expiresAt } =
        this._data;
      return {
        ...base,
        state: 'COMPLETED',
        debitAmount,
        receiveAmount,
        exchangeRate,
        expiresAt
      };
    }
    if (this._data.state === 'FAILED') {
      const { errorName, message } = this._data;
      return { ...base, state: 'FAILED', errorName, message };
    }
    return {
      ...base,
      state: 'PENDING',
      debitAmount: this._data.debitAmount,
      receiveAmount: this._data.receiveAmount
    };
  }

  get id(): string {
    return this._id;
  }

  get state(): QuoteState {
    return this._data.state;
  }

  get senderWalletAddress(): string {
    return this._senderWalletAddress;
  }

  get senderWalletAddressId(): string {
    return this._senderWalletAddressId;
  }
}

interface Payment {
  id: string;
  state: PaymentState;
  quoteId?: string;
  paymentIntentId: string;
  senderWalletAddress: string;
  senderWalletAddressId: string;
  assetScale: number;
  assetCode: string;
  debitAmount: bigint;
  receiveAmount: bigint;
  sentAmount: bigint;
}

export class PaymentIntent implements IPaymentIntent {
  private _id: string;
  private _receiverWalletAddressId: string | undefined;
  private _receiverWalletAddress: string;
  private _state: PaymentIntentState;
  private _destination: PaymentIntentDestination;
  private _assetCode: string;
  private _assetScale: number;
  private _expiresAt: Date;
  private _incomingAmount: bigint | null;
  private _receivedAmount: bigint;
  private _quotes: Quote[] = [];
  private _payments: Payment[] = [];
  private _destinationIlpAddress: string | undefined;
  private _remoteUrl: string | undefined;

  private constructor(
    id: string,
    receiverWalletAddressId: string | undefined,
    receiverWalletAddress: string,
    destination: PaymentIntentDestination,
    assetCode: string,
    assetScale: number,
    expiresAt: Date,
    incomingAmount: bigint | null = null,
    receivedAmount: bigint = 0n,
    state: PaymentIntentState = PaymentIntentState.CREATED,
    quotes: Quote[] = [],
    payments: Payment[] = [],
    destinationIlpAddress?: string,
    remoteUrl?: string
  ) {
    this._id = id;
    this._receiverWalletAddressId = receiverWalletAddressId;
    this._receiverWalletAddress = receiverWalletAddress;
    this._destination = destination;
    this._assetCode = assetCode;
    this._assetScale = assetScale;

    this._incomingAmount = incomingAmount;
    this._receivedAmount = receivedAmount;
    this._state = state;
    this._quotes = quotes;
    this._payments = payments;

    this._expiresAt = expiresAt;
    this._destinationIlpAddress = destinationIlpAddress;
    this._remoteUrl = remoteUrl;
  }

  static create(
    id: string,
    receiverWalletAddressId: string | undefined,
    receiverWalletAddress: string,
    destination: PaymentIntentDestination,
    assetCode: string,
    assetScale: number,
    expiresAt: string | null,
    incomingAmount: bigint | null = null,
    receivedAmount: bigint = 0n,
    destinationIlpAddress?: string,
    remoteUrl?: string
  ): PaymentIntent {
    if (destination === 'LOCAL' && !receiverWalletAddressId) {
      throw new InvalidPaymentIntentError(
        'receiverWalletAddressId is required for LOCAL payment intents'
      );
    }

    const resolvedExpiresAt = expiresAt
      ? new Date(expiresAt)
      : new Date(Date.now() + MAX_PAYMENT_INTENT_EXPIRY_MS);

    if (resolvedExpiresAt.getTime() <= Date.now()) {
      throw new InvalidPaymentIntentExpiryError(
        'expiresAt must be in the future'
      );
    }
    if (
      resolvedExpiresAt.getTime() >
      Date.now() + MAX_PAYMENT_INTENT_EXPIRY_MS
    ) {
      throw new InvalidPaymentIntentExpiryError(
        'expiresAt must be within 30 days'
      );
    }

    return new PaymentIntent(
      id,
      receiverWalletAddressId,
      receiverWalletAddress,
      destination,
      assetCode,
      assetScale,
      resolvedExpiresAt,
      incomingAmount,
      receivedAmount,
      undefined,
      undefined,
      undefined,
      destinationIlpAddress,
      remoteUrl
    );
  }

  static fromObject(obj: IPaymentIntent): PaymentIntent {
    return new PaymentIntent(
      obj.id,
      obj.receiverWalletAddressId,
      obj.receiverWalletAddress,
      obj.destination,
      obj.assetCode,
      obj.assetScale,
      obj.expiresAt,
      obj.incomingAmount,
      obj.receivedAmount,
      obj.state,
      obj.quotes.map((q) => Quote.fromObject(q)),
      obj.payments.map((payment) => ({
        id: payment.id,
        senderWalletAddress: payment.senderWalletAddress,
        senderWalletAddressId: payment.senderWalletAddressId,
        paymentIntentId: payment.paymentIntentId,
        quoteId: payment.quoteId,
        assetCode: payment.assetCode,
        assetScale: payment.assetScale,
        sentAmount: payment.sentAmount,
        state: payment.state,
        debitAmount: payment.debitAmount,
        receiveAmount: payment.receiveAmount
      })),
      obj.destinationIlpAddress,
      obj.remoteUrl
    );
  }

  toObject(): IPaymentIntent {
    return {
      id: this._id,
      receiverWalletAddressId: this._receiverWalletAddressId,
      receiverWalletAddress: this._receiverWalletAddress,
      state: this._state,
      destination: this._destination,
      assetCode: this._assetCode,
      assetScale: this._assetScale,
      expiresAt: this._expiresAt,
      incomingAmount: this._incomingAmount,
      receivedAmount: this._receivedAmount,
      quotes: this._quotes.map((q) => q.toObject()),
      payments: this._payments.map((payment) => ({
        id: payment.id,
        state: payment.state,
        senderWalletAddress: payment.senderWalletAddress,
        paymentIntentId: this.id,
        senderWalletAddressId: payment.senderWalletAddressId,
        quoteId: payment.quoteId,
        assetCode: payment.assetCode,
        assetScale: payment.assetScale,
        debitAmount: payment.debitAmount,
        receiveAmount: payment.receiveAmount,
        sentAmount: payment.sentAmount
      })),
      destinationIlpAddress: this._destinationIlpAddress,
      remoteUrl: this._remoteUrl
    };
  }

  addLocalQuote(args: {
    id: string;
    receiveAmount?: bigint;
    debitAmount?: bigint;
    exchangeRate: number;
    senderWalletAddress: {
      id: string;
      address: string;
      assetCode: string;
      assetScale: number;
    };
  }): ICompletedQuote {
    const {
      id,
      debitAmount,
      receiveAmount,
      senderWalletAddress,
      exchangeRate: unscaledExchangeRate
    } = args;

    if (this.state !== 'CREATED') {
      throw new PaymentIntentInvalidState(
        `Payment intent is in an invalid state for quoting: ${this.state}`
      );
    }

    if (this.isExpired) {
      throw new PaymentIntentExpired(
        `Payment intent is expired at: ${this.expiresAt.toISOString()}`
      );
    }

    if (this._quotes.find((q) => q.id === id)) {
      throw new InvalidQuoteIdError(
        `Duplicate quote id ${id} exists for ${this.id} payment intent`
      );
    }

    let quoteReceiveAmount: bigint;
    let quoteDebitAmount: bigint;

    const scaleDiff = this.assetScale - senderWalletAddress.assetScale;
    const exchangeRate = unscaledExchangeRate * 10 ** scaleDiff;

    if (debitAmount) {
      quoteReceiveAmount = BigInt(
        Math.floor(Number(debitAmount) * exchangeRate)
      );
      quoteDebitAmount = debitAmount;
    } else if (receiveAmount) {
      quoteDebitAmount = BigInt(
        Math.ceil(Number(receiveAmount) / exchangeRate)
      );
      quoteReceiveAmount = receiveAmount;
    } else if (this.incomingAmount) {
      quoteDebitAmount = BigInt(
        Math.ceil(Number(this.incomingAmount) / exchangeRate)
      );
      quoteReceiveAmount = this.incomingAmount;
    } else {
      throw new InvalidQuoteAmountError(
        'Quote request must have debitAmount, receiveAmount, or the payment intent must have an incomingAmount'
      );
    }

    const quote = Quote.createPending(
      id,
      senderWalletAddress.address,
      senderWalletAddress.id
    );
    quote.complete({
      debitAmount: quoteDebitAmount,
      receiveAmount: quoteReceiveAmount,
      exchangeRate,
      paymentIntentExpiresAt: this.expiresAt
    });
    this._quotes.push(quote);
    return quote.toObject() as ICompletedQuote;
  }

  addPendingRemoteQuote(args: {
    id: string;
    senderWalletAddress: {
      id: string;
      address: string;
    };
    debitAmount?: bigint;
    receiveAmount?: bigint;
  }): IPendingQuote {
    const { id, senderWalletAddress, debitAmount } = args;
    const receiveAmount =
      args.receiveAmount ?? this._incomingAmount ?? undefined;

    if (this.state !== 'CREATED') {
      throw new PaymentIntentInvalidState(
        `Payment intent is in an invalid state for quoting: ${this.state}`
      );
    }

    if (this.isExpired) {
      throw new PaymentIntentExpired(
        `Payment intent is expired at: ${this.expiresAt.toISOString()}`
      );
    }

    if (this._quotes.find((quote) => quote.id === id)) {
      throw new InvalidQuoteIdError(
        `Duplicate quote id ${id} exists for ${this.id} payment intent`
      );
    }

    if (!debitAmount && !receiveAmount) {
      throw new InvalidQuoteAmountError(
        'Pending remote quote must have debitAmount or receiveAmount'
      );
    }

    const quote = Quote.createPending(
      id,
      senderWalletAddress.address,
      senderWalletAddress.id,
      debitAmount,
      receiveAmount
    );
    this._quotes.push(quote);
    return quote.toObject() as IPendingQuote;
  }

  completeRemoteQuote(args: {
    id: string;
    debitAmount: bigint;
    receiveAmount: bigint;
    exchangeRate: number;
  }): ICompletedQuote {
    const { id, debitAmount, receiveAmount, exchangeRate } = args;

    const quote = this._quotes.find((q) => q.id === id);
    if (!quote) {
      throw new InvalidQuoteIdError(
        `Quote ${id} not found for ${this.id} payment intent`
      );
    }

    if (this.isExpired) {
      throw new PaymentIntentExpired(
        `Payment intent is expired at: ${this.expiresAt.toISOString()}`
      );
    }

    quote.complete({
      debitAmount,
      receiveAmount,
      exchangeRate,
      paymentIntentExpiresAt: this.expiresAt
    });
    return quote.toObject() as ICompletedQuote;
  }

  failRemoteQuote(args: {
    id: string;
    errorName: string;
    message: string;
  }): void {
    const { id, errorName, message } = args;

    const quote = this._quotes.find((q) => q.id === id);
    if (!quote) {
      throw new InvalidQuoteIdError(
        `Quote ${id} not found for ${this.id} payment intent`
      );
    }

    quote.fail({ errorName, message });
  }

  addLocalPayment(args: {
    id: string;
    quoteId?: string;
    senderWalletAddress: {
      id: string;
      address: string;
      assetCode: string;
      assetScale: number;
    };
    exchangeRate: number;
    debitAmount?: bigint;
  }): void {
    const {
      id,
      senderWalletAddress,
      quoteId,
      debitAmount,
      exchangeRate: unscaledExchangeRate
    } = args;

    if (this.state !== 'CREATED') {
      throw new PaymentIntentInvalidState(
        `Payment intent is in an invalid state for payment: ${this.state}`
      );
    }

    if (this.isExpired) {
      throw new PaymentIntentExpired(
        `Payment intent is expired at: ${this.expiresAt.toISOString()}`
      );
    }

    if (this._payments.find((payment) => payment.id === id)) {
      throw new InvalidPaymentIdError(
        `Duplicate payment id ${id} exists for ${this.id} payment intent`
      );
    }

    let paymentReceiveAmount: bigint;
    let paymentDebitAmount: bigint;

    const scaleDiff = this.assetScale - senderWalletAddress.assetScale;
    const exchangeRate = unscaledExchangeRate * 10 ** scaleDiff;

    // NOTE: do we want to subtract the already receivedAmount from the payment?
    if (quoteId) {
      const quote = this.quotes.find((quote) => quote.id === quoteId);
      if (!quote) {
        throw new InvalidQuoteIdError(
          `Could not find ${quoteId} quote for ${this.id} payment intent`
        );
      }

      // TODO: do we want to make this a requirement? ie, does it matter if we "re-use" a quote?
      if (
        this._payments.find(
          (payment) =>
            payment.quoteId === quoteId && payment.state === 'COMPLETED'
        )
      ) {
        throw new InvalidQuoteStateError(
          `Already consumed quote ${quoteId} for payment ${id}`
        );
      }

      if (quote.senderWalletAddressId !== senderWalletAddress.id) {
        throw new InvalidQuoteStateError(
          `Invalid sender wallet address for quote ${quoteId}`
        );
      }

      if (quote.state !== 'COMPLETED') {
        throw new InvalidQuoteStateError(
          `Quote ${quoteId} is not completed for payment creation`
        );
      }

      if (quote.expiresAt.getTime() <= Date.now()) {
        throw new QuoteExpiredError(
          `Quote expired for payment creation against payment intent: ${this.id}`
        );
      }

      paymentDebitAmount = quote.debitAmount;
      paymentReceiveAmount = quote.receiveAmount;
    } else if (debitAmount) {
      paymentDebitAmount = debitAmount;
      paymentReceiveAmount = BigInt(
        Math.floor(Number(debitAmount) * exchangeRate)
      );
    } else if (this.incomingAmount) {
      paymentDebitAmount = BigInt(
        Math.ceil(Number(this.incomingAmount) / exchangeRate)
      );
      paymentReceiveAmount = this.incomingAmount;
    } else {
      throw new InvalidPaymentAmountError(
        'Payment request must have debitAmount or quoteId, or the payment intent must have an incomingAmount'
      );
    }

    const payment: Payment = {
      id,
      state: 'CREATED',
      senderWalletAddress: senderWalletAddress.address,
      senderWalletAddressId: senderWalletAddress.id,
      paymentIntentId: this.id,
      assetCode: senderWalletAddress.assetCode,
      assetScale: senderWalletAddress.assetScale,
      debitAmount: paymentDebitAmount,
      receiveAmount: paymentReceiveAmount,
      sentAmount: 0n,
      quoteId
    };

    this._payments.push(payment);
  }

  completeLocalPayment(args: { id: string }): void {
    const { id } = args;

    if (this.state !== 'CREATED') {
      throw new PaymentIntentInvalidState(
        `Payment intent is in an invalid state for payment: ${this.state}`
      );
    }

    if (this.isExpired) {
      throw new PaymentIntentExpired(
        `Payment intent is expired at: ${this.expiresAt.toISOString()}`
      );
    }

    const payment = this._payments.find((payment) => payment.id === id);
    if (!payment) {
      throw new PaymentNotFoundError(
        `Payment ${id} not found for ${this.id} payment intent`
      );
    }

    if (payment.state === 'COMPLETED') {
      throw new PaymentInvalidStateError(`Payment ${id} is already completed`);
    }

    // TODO: determine if we want to allow paying more than the incomingAmount.
    // For now, the logic is that we allow overpaying the incomingAmount once.

    payment.sentAmount += payment.debitAmount;
    this._receivedAmount += payment.receiveAmount;

    if (this._incomingAmount && this.receivedAmount >= this._incomingAmount) {
      this._state = 'COMPLETED';
    }
    payment.state = 'COMPLETED';
  }

  get id(): string {
    return this._id;
  }

  get receiverWalletAddressId(): string | undefined {
    return this._receiverWalletAddressId;
  }

  get receiverWalletAddress(): string {
    return this._receiverWalletAddress;
  }

  get state(): PaymentIntentState {
    return this._state;
  }

  get destination(): PaymentIntentDestination {
    return this._destination;
  }

  get assetCode(): string {
    return this._assetCode;
  }

  get assetScale(): number {
    return this._assetScale;
  }

  get expiresAt(): Date {
    return this._expiresAt;
  }

  get isExpired(): boolean {
    return this._expiresAt.getTime() < Date.now();
  }

  get incomingAmount(): bigint | null {
    return this._incomingAmount;
  }

  get receivedAmount(): bigint {
    return this._receivedAmount;
  }

  get quotes(): IQuote[] {
    return this._quotes.map((q) => q.toObject());
  }

  get payments(): Payment[] {
    return this._payments;
  }

  get destinationIlpAddress(): string | undefined {
    return this._destinationIlpAddress;
  }

  get remoteUrl(): string | undefined {
    return this._remoteUrl;
  }
}
