import {
  InvalidPaymentAmountError,
  InvalidPaymentIdError,
  InvalidPaymentIntentError,
  InvalidPaymentIntentExpiryError,
  InvalidQuoteAmountError,
  InvalidQuoteIdError,
  InvalidQuoteStateError,
  MissingFxRateError,
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
  IPayment,
  IQuote,
  PaymentIntentDestination,
  PaymentIntentState,
  QuoteState
} from './interfaces';

const MAX_PAYMENT_INTENT_EXPIRY_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const QUOTE_EXPIRY_MS = 1000 * 60 * 10;

type QuoteData =
  | {
      state: 'PENDING';
      debitAmount?: bigint;
      receiveAmount?: bigint;
      peerId?: string;
      peerAssetCode?: string;
      peerAssetScale?: number;
      sourceAmount?: bigint;
      senderAssetCode?: string;
    }
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
    peerId?: string,
    peerAssetCode?: string,
    peerAssetScale?: number,
    sourceAmount?: bigint,
    senderAssetCode?: string,
    debitAmount?: bigint,
    receiveAmount?: bigint
  ): Quote {
    return new Quote(id, senderWalletAddress, senderWalletAddressId, {
      state: 'PENDING',
      peerId,
      peerAssetCode,
      peerAssetScale,
      sourceAmount,
      senderAssetCode,
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
          peerId: obj.peerId,
          peerAssetCode: obj.peerAssetCode,
          peerAssetScale: obj.peerAssetScale,
          sourceAmount: obj.sourceAmount,
          senderAssetCode: obj.senderAssetCode,
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

  completeRemote(args: {
    receiveAmountValue: bigint;
    fxRate?: number;
    paymentIntentExpiresAt: Date;
  }): void {
    if (this._data.state !== 'PENDING') {
      throw new InvalidQuoteStateError(
        `Quote ${this._id} is not in PENDING state, cannot complete`
      );
    }

    const {
      peerAssetCode,
      sourceAmount,
      senderAssetCode,
      debitAmount: requestedDebit,
      receiveAmount: requestedReceive
    } = this._data;

    if (!peerAssetCode || !sourceAmount || !senderAssetCode) {
      throw new InvalidQuoteStateError(
        `Pending quote ${this._id} is missing required remote peer fields`
      );
    }

    const { receiveAmountValue, fxRate, paymentIntentExpiresAt } = args;
    const peerToReceiverRate =
      Number(receiveAmountValue) / Number(sourceAmount);
    const isCrossAsset = senderAssetCode !== peerAssetCode;

    let computedDebit: bigint;
    let computedReceive: bigint;

    if (!isCrossAsset) {
      if (requestedDebit) {
        computedDebit = requestedDebit;
        computedReceive = BigInt(
          Math.floor(Number(requestedDebit) * peerToReceiverRate)
        );
      } else if (requestedReceive !== undefined) {
        computedReceive = requestedReceive;
        computedDebit = BigInt(
          Math.ceil(Number(requestedReceive) / peerToReceiverRate)
        );
      } else {
        throw new InvalidQuoteStateError(
          `Pending quote ${this._id} must have debit or receive amount`
        );
      }
    } else {
      if (fxRate == null) {
        throw new MissingFxRateError(
          `Cross-asset quote ${this._id} requires an fxRate (sender: ${senderAssetCode}, peer: ${peerAssetCode})`
        );
      }
      if (requestedDebit) {
        computedDebit = requestedDebit;
        computedReceive = BigInt(
          Math.floor(Number(requestedDebit) * fxRate * peerToReceiverRate)
        );
      } else if (requestedReceive !== undefined) {
        computedReceive = requestedReceive;
        computedDebit = BigInt(
          Math.ceil(
            Number(requestedReceive) * (1 / peerToReceiverRate) * fxRate
          )
        );
      } else {
        throw new InvalidQuoteStateError(
          `Pending quote ${this._id} must have debit or receive amount`
        );
      }
    }

    const exchangeRate = Number(computedReceive) / Number(computedDebit);

    this._data = {
      state: 'COMPLETED',
      debitAmount: computedDebit,
      receiveAmount: computedReceive,
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
      peerId: this._data.peerId,
      peerAssetCode: this._data.peerAssetCode,
      peerAssetScale: this._data.peerAssetScale,
      sourceAmount: this._data.sourceAmount,
      senderAssetCode: this._data.senderAssetCode,
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

export class PaymentIntent implements IPaymentIntent {
  private _id: string;
  private _receiverWalletAddressId: string | undefined;
  private _receiverWalletAddress: string;
  private _state: PaymentIntentState;
  private _destination: PaymentIntentDestination;
  private _assetCode: string;
  private _assetScale: number;
  private _createdAt: Date;
  private _expiresAt: Date;
  private _incomingAmount: bigint | null;
  private _receivedAmount: bigint;
  private _quotes: Quote[] = [];
  private _payments: IPayment[] = [];
  private _destinationIlpAddress: string | undefined;
  private _remoteUrl: string | undefined;

  private constructor(
    id: string,
    receiverWalletAddressId: string | undefined,
    receiverWalletAddress: string,
    destination: PaymentIntentDestination,
    assetCode: string,
    assetScale: number,
    createdAt: Date,
    expiresAt: Date,
    incomingAmount: bigint | null = null,
    receivedAmount: bigint = 0n,
    state: PaymentIntentState = PaymentIntentState.CREATED,
    quotes: Quote[] = [],
    payments: IPayment[] = [],
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

    this._createdAt = createdAt;
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

    const createdAt = new Date();

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
      createdAt,
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
      obj.createdAt,
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
        createdAt: payment.createdAt,
        sentAmount: payment.sentAmount,
        state: payment.state,
        debitAmount: payment.debitAmount,
        receiveAmount: payment.receiveAmount,
        cancelledAt: payment.cancelledAt,
        cancelReason: payment.cancelReason
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
      createdAt: this._createdAt,
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
        createdAt: payment.createdAt,
        debitAmount: payment.debitAmount,
        receiveAmount: payment.receiveAmount,
        sentAmount: payment.sentAmount,
        cancelledAt: payment.cancelledAt,
        cancelReason: payment.cancelReason
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
      assetCode: string;
      assetScale: number;
    };
    peerId: string;
    peerAssetCode: string;
    peerAssetScale: number;
    sourceAmount: bigint;
    debitAmount?: bigint;
    receiveAmount?: bigint;
  }): IPendingQuote {
    const {
      id,
      senderWalletAddress,
      peerId,
      peerAssetCode,
      peerAssetScale,
      sourceAmount,
      debitAmount
    } = args;
    const senderAssetCode = senderWalletAddress.assetCode;
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
      peerId,
      peerAssetCode,
      peerAssetScale,
      sourceAmount,
      senderAssetCode,
      debitAmount,
      receiveAmount
    );
    this._quotes.push(quote);
    return quote.toObject() as IPendingQuote;
  }

  completeRemoteQuote(args: {
    id: string;
    receiveAmountValue: bigint;
    fxRate?: number;
  }): ICompletedQuote {
    const { id, receiveAmountValue, fxRate } = args;

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

    quote.completeRemote({
      receiveAmountValue,
      fxRate,
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
  }): IPayment {
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

    const payment: IPayment = {
      id,
      state: 'CREATED',
      senderWalletAddress: senderWalletAddress.address,
      senderWalletAddressId: senderWalletAddress.id,
      paymentIntentId: this.id,
      assetCode: senderWalletAddress.assetCode,
      assetScale: senderWalletAddress.assetScale,
      createdAt: new Date(),
      debitAmount: paymentDebitAmount,
      receiveAmount: paymentReceiveAmount,
      sentAmount: 0n,
      quoteId
    };

    this._payments.push(payment);
    return payment;
  }

  completeLocalPayment(args: { id: string }): IPayment {
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

    if (payment.state === 'CANCELLED') {
      throw new PaymentInvalidStateError(`Payment ${id} was cancelled`);
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
    return payment;
  }

  cancelPayment(args: { id: string; reason?: string }): void {
    const { id, reason } = args;

    const payment = this._payments.find((payment) => payment.id === id);
    if (!payment) {
      throw new PaymentNotFoundError(
        `Payment ${id} not found for ${this.id} payment intent`
      );
    }

    if (payment.state === 'CANCELLED') {
      throw new PaymentInvalidStateError(`Payment ${id} is already cancelled`);
    }

    if (payment.state === 'COMPLETED') {
      throw new PaymentInvalidStateError(`Payment ${id} is already complete`);
    }

    payment.state = 'CANCELLED';
    payment.cancelledAt = new Date();
    if (reason) {
      payment.cancelReason = reason;
    }
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

  get createdAt(): Date {
    return this._createdAt;
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

  get payments(): IPayment[] {
    return this._payments;
  }

  get destinationIlpAddress(): string | undefined {
    return this._destinationIlpAddress;
  }

  get remoteUrl(): string | undefined {
    return this._remoteUrl;
  }
}
