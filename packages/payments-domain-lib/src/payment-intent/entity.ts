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
  ISentPayment,
  IQuote,
  IInboundPayment,
  PaymentIntentDestination,
  PaymentIntentState,
  SentPaymentState,
  QuoteState,
  InboundPaymentState
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
  private _createdAt: Date;
  private _data: QuoteData;

  private constructor(
    id: string,
    senderWalletAddress: string,
    senderWalletAddressId: string,
    createdAt: Date,
    data: QuoteData
  ) {
    this._id = id;
    this._senderWalletAddress = senderWalletAddress;
    this._senderWalletAddressId = senderWalletAddressId;
    this._createdAt = createdAt;
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
    return new Quote(
      id,
      senderWalletAddress,
      senderWalletAddressId,
      new Date(),
      {
        state: 'PENDING',
        peerId,
        peerAssetCode,
        peerAssetScale,
        sourceAmount,
        senderAssetCode,
        debitAmount,
        receiveAmount
      }
    );
  }

  static fromObject(obj: IQuote): Quote {
    const createdAt = obj.createdAt ?? new Date();
    if (obj.state === 'COMPLETED') {
      return new Quote(
        obj.id,
        obj.senderWalletAddress,
        obj.senderWalletAddressId,
        createdAt,
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
        createdAt,
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
        createdAt,
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
        `Pending quote ${this._id} is missing required remote peer fields (peerAssetCode, sourceAmount, senderAssetCode)`
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
      senderWalletAddressId: this._senderWalletAddressId,
      createdAt: this._createdAt
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

  get createdAt(): Date {
    return this._createdAt;
  }
}

class SentPayment {
  private _id: string;
  private _senderWalletAddress: string;
  private _senderWalletAddressId: string;
  private _paymentIntentId: string;
  private _assetCode: string;
  private _assetScale: number;
  private _createdAt: Date;
  private _debitAmount: bigint;
  private _receiveAmount: bigint;
  private _quoteId?: string;
  private _state: SentPaymentState;
  private _sentAmount: bigint;
  private _cancelledAt?: Date;
  private _cancelReason?: string;
  private _ledgerTransferId?: string;
  private _failReason?: string;
  private _grantId?: string;
  private _metadata?: Record<string, unknown>;

  private constructor(args: {
    id: string;
    state: SentPaymentState;
    senderWalletAddress: string;
    senderWalletAddressId: string;
    paymentIntentId: string;
    assetCode: string;
    assetScale: number;
    createdAt: Date;
    debitAmount: bigint;
    receiveAmount: bigint;
    sentAmount: bigint;
    quoteId?: string;
    cancelledAt?: Date;
    cancelReason?: string;
    ledgerTransferId?: string;
    failReason?: string;
    grantId?: string;
    metadata?: Record<string, unknown>;
  }) {
    this._id = args.id;
    this._state = args.state;
    this._senderWalletAddress = args.senderWalletAddress;
    this._senderWalletAddressId = args.senderWalletAddressId;
    this._paymentIntentId = args.paymentIntentId;
    this._assetCode = args.assetCode;
    this._assetScale = args.assetScale;
    this._createdAt = args.createdAt;
    this._debitAmount = args.debitAmount;
    this._receiveAmount = args.receiveAmount;
    this._sentAmount = args.sentAmount;
    this._quoteId = args.quoteId;
    this._cancelledAt = args.cancelledAt;
    this._cancelReason = args.cancelReason;
    this._ledgerTransferId = args.ledgerTransferId;
    this._failReason = args.failReason;
    this._grantId = args.grantId;
    this._metadata = args.metadata;
  }

  static create(args: {
    id: string;
    senderWalletAddress: string;
    senderWalletAddressId: string;
    paymentIntentId: string;
    assetCode: string;
    assetScale: number;
    debitAmount: bigint;
    receiveAmount: bigint;
    quoteId?: string;
    grantId?: string;
    metadata?: Record<string, unknown>;
  }): SentPayment {
    return new SentPayment({
      ...args,
      state: 'CREATED',
      createdAt: new Date(),
      sentAmount: 0n
    });
  }

  static fromObject(obj: ISentPayment): SentPayment {
    return new SentPayment({
      id: obj.id,
      state: obj.state,
      senderWalletAddress: obj.senderWalletAddress,
      senderWalletAddressId: obj.senderWalletAddressId,
      paymentIntentId: obj.paymentIntentId,
      assetCode: obj.assetCode,
      assetScale: obj.assetScale,
      createdAt: obj.createdAt,
      debitAmount: obj.debitAmount,
      receiveAmount: obj.receiveAmount,
      sentAmount: obj.sentAmount,
      quoteId: obj.quoteId,
      cancelledAt: obj.cancelledAt,
      cancelReason: obj.cancelReason,
      ledgerTransferId: obj.ledgerTransferId,
      failReason: obj.failReason,
      grantId: obj.grantId,
      metadata: obj.metadata
    });
  }

  toObject(): ISentPayment {
    return {
      id: this._id,
      state: this._state,
      senderWalletAddress: this._senderWalletAddress,
      senderWalletAddressId: this._senderWalletAddressId,
      paymentIntentId: this._paymentIntentId,
      assetCode: this._assetCode,
      assetScale: this._assetScale,
      createdAt: this._createdAt,
      debitAmount: this._debitAmount,
      receiveAmount: this._receiveAmount,
      sentAmount: this._sentAmount,
      quoteId: this._quoteId,
      cancelledAt: this._cancelledAt,
      cancelReason: this._cancelReason,
      ledgerTransferId: this._ledgerTransferId,
      failReason: this._failReason,
      grantId: this._grantId,
      metadata: this._metadata
    };
  }

  complete(): { debitAmount: bigint; receiveAmount: bigint } {
    if (this._state === 'CANCELLED') {
      throw new PaymentInvalidStateError(`Payment ${this._id} was cancelled`);
    }
    if (this._state === 'COMPLETED') {
      throw new PaymentInvalidStateError(
        `Payment ${this._id} is already completed`
      );
    }
    this._sentAmount += this._debitAmount;
    this._state = 'COMPLETED';
    return {
      debitAmount: this._debitAmount,
      receiveAmount: this._receiveAmount
    };
  }

  approveRemoteSend(): void {
    if (this._state !== 'CREATED') {
      throw new PaymentInvalidStateError(
        `Payment ${this._id} cannot be approved for remote send from state ${this._state}`
      );
    }
    this._state = 'PROCESSING';
  }

  prepare(ledgerTransferId: string): void {
    if (this._state !== 'PROCESSING') {
      throw new PaymentInvalidStateError(
        `Payment ${this._id} cannot be prepared from state ${this._state}`
      );
    }
    this._state = 'SENDING';
    this._ledgerTransferId = ledgerTransferId;
  }

  failRemote(reason?: string): void {
    if (this._state !== 'PROCESSING' && this._state !== 'REJECTED') {
      throw new PaymentInvalidStateError(
        `Payment ${this._id} cannot fail from state ${this._state}`
      );
    }
    this._state = 'FAILED';
    if (reason) {
      this._failReason = reason;
    }
  }

  completeRemote(): { debitAmount: bigint; receiveAmount: bigint } {
    if (this._state !== 'CONFIRMED') {
      throw new PaymentInvalidStateError(
        `Payment ${this._id} cannot complete from state ${this._state}`
      );
    }
    this._sentAmount += this._debitAmount;
    this._state = 'COMPLETED';
    return {
      debitAmount: this._debitAmount,
      receiveAmount: this._receiveAmount
    };
  }

  confirm(): void {
    if (this._state !== 'SENDING') {
      throw new PaymentInvalidStateError(
        `Payment ${this._id} cannot be confirmed from state ${this._state}`
      );
    }
    this._state = 'CONFIRMED';
  }

  reject(reason?: string): void {
    if (this._state !== 'SENDING') {
      throw new PaymentInvalidStateError(
        `Payment ${this._id} cannot be rejected from state ${this._state}`
      );
    }
    this._state = 'REJECTED';
    if (reason) {
      this._failReason = reason;
    }
  }

  cancel(reason?: string): void {
    if (this._state === 'CANCELLED') {
      throw new PaymentInvalidStateError(
        `Payment ${this._id} is already cancelled`
      );
    }
    if (this._state === 'COMPLETED') {
      throw new PaymentInvalidStateError(
        `Payment ${this._id} is already complete`
      );
    }
    this._state = 'CANCELLED';
    this._cancelledAt = new Date();
    if (reason) {
      this._cancelReason = reason;
    }
  }

  get id(): string {
    return this._id;
  }

  get state(): SentPaymentState {
    return this._state;
  }

  get quoteId(): string | undefined {
    return this._quoteId;
  }

  get grantId(): string | undefined {
    return this._grantId;
  }

  get senderWalletAddressId(): string {
    return this._senderWalletAddressId;
  }

  get senderWalletAddress(): string {
    return this._senderWalletAddress;
  }

  get assetCode(): string {
    return this._assetCode;
  }

  get assetScale(): number {
    return this._assetScale;
  }

  get debitAmount(): bigint {
    return this._debitAmount;
  }

  get receiveAmount(): bigint {
    return this._receiveAmount;
  }

  get sentAmount(): bigint {
    return this._sentAmount;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get ledgerTransferId(): string | undefined {
    return this._ledgerTransferId;
  }

  get failReason(): string | undefined {
    return this._failReason;
  }

  get metadata(): Record<string, unknown> | undefined {
    return this._metadata;
  }
}

class InboundPayment {
  private _id: string;
  private _state: InboundPaymentState;
  private _paymentIntentId: string;
  private _packetId: string;
  private _peerId: string;
  private _peerAssetCode: string;
  private _peerAssetScale: number;
  private _sourceAmount: bigint;
  private _receiveAmount: bigint;
  private _createdAt: Date;
  private _expiresAt?: Date;
  private _ledgerTransferId?: string;
  private _failReason?: string;

  private constructor(args: IInboundPayment) {
    this._id = args.id;
    this._state = args.state;
    this._paymentIntentId = args.paymentIntentId;
    this._packetId = args.packetId;
    this._peerId = args.peerId;
    this._peerAssetCode = args.peerAssetCode;
    this._peerAssetScale = args.peerAssetScale;
    this._sourceAmount = args.sourceAmount;
    this._receiveAmount = args.receiveAmount;
    this._createdAt = args.createdAt;
    this._expiresAt = args.expiresAt;
    this._ledgerTransferId = args.ledgerTransferId;
    this._failReason = args.failReason;
  }

  static create(args: {
    id: string;
    paymentIntentId: string;
    packetId: string;
    peerId: string;
    peerAssetCode: string;
    peerAssetScale: number;
    sourceAmount: bigint;
    receiveAmount: bigint;
    expiresAt?: Date;
  }): InboundPayment {
    return new InboundPayment({
      ...args,
      state: 'VALIDATED',
      createdAt: new Date()
    });
  }

  static fromObject(obj: IInboundPayment): InboundPayment {
    return new InboundPayment(obj);
  }

  accept(ledgerTransferId: string): void {
    if (this._state !== 'VALIDATED') {
      throw new PaymentInvalidStateError(
        `Inbound payment ${this._id} cannot be accepted from state ${this._state}`
      );
    }
    this._state = 'ACCEPTED';
    this._ledgerTransferId = ledgerTransferId;
  }

  markFulfillable(): void {
    if (this._state !== 'ACCEPTED') {
      throw new PaymentInvalidStateError(
        `Inbound payment ${this._id} cannot be marked fulfillable from state ${this._state}`
      );
    }
    this._state = 'FULFILLABLE';
  }

  fail(reason?: string): void {
    if (
      this._state !== 'VALIDATED' &&
      this._state !== 'ACCEPTED' &&
      this._state !== 'FULFILLABLE'
    ) {
      throw new PaymentInvalidStateError(
        `Inbound payment ${this._id} cannot fail from state ${this._state}`
      );
    }
    this._state = 'FAILED';
    if (reason) {
      this._failReason = reason;
    }
  }

  finalize(): { receiveAmount: bigint } {
    if (this._state !== 'FULFILLABLE') {
      throw new PaymentInvalidStateError(
        `Inbound payment ${this._id} cannot be finalized from state ${this._state}`
      );
    }
    this._state = 'FINALIZED';
    return { receiveAmount: this._receiveAmount };
  }

  toObject(): IInboundPayment {
    return {
      id: this._id,
      state: this._state,
      paymentIntentId: this._paymentIntentId,
      packetId: this._packetId,
      peerId: this._peerId,
      peerAssetCode: this._peerAssetCode,
      peerAssetScale: this._peerAssetScale,
      sourceAmount: this._sourceAmount,
      receiveAmount: this._receiveAmount,
      createdAt: this._createdAt,
      expiresAt: this._expiresAt,
      ledgerTransferId: this._ledgerTransferId,
      failReason: this._failReason
    };
  }

  get id(): string {
    return this._id;
  }

  get state(): InboundPaymentState {
    return this._state;
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
  private _sentPayments: SentPayment[] = [];
  private _inboundPayments: InboundPayment[] = [];
  private _destinationIlpAddress: string | undefined;
  private _remoteUrl: string | undefined;
  private _peerId: string | undefined;
  private _metadata: Record<string, unknown> | undefined;

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
    sentPayments: SentPayment[] = [],
    inboundPayments: InboundPayment[] = [],
    destinationIlpAddress?: string,
    remoteUrl?: string,
    peerId?: string,
    metadata?: Record<string, unknown>
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
    this._sentPayments = sentPayments;
    this._inboundPayments = inboundPayments;

    this._createdAt = createdAt;
    this._expiresAt = expiresAt;
    this._destinationIlpAddress = destinationIlpAddress;
    this._remoteUrl = remoteUrl;
    this._peerId = peerId;
    this._metadata = metadata;
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
    remoteUrl?: string,
    metadata?: Record<string, unknown>
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
      undefined,
      destinationIlpAddress,
      remoteUrl,
      undefined,
      metadata
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
      obj.sentPayments.map((p) => SentPayment.fromObject(p)),
      obj.inboundPayments.map((rp) => InboundPayment.fromObject(rp)),
      obj.destinationIlpAddress,
      obj.remoteUrl,
      obj.peerId,
      obj.metadata
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
      sentPayments: this._sentPayments.map((p) => p.toObject()),
      inboundPayments: this._inboundPayments.map((rp) => rp.toObject()),
      destinationIlpAddress: this._destinationIlpAddress,
      remoteUrl: this._remoteUrl,
      peerId: this._peerId,
      metadata: this._metadata
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

    this._peerId = peerId;

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

  /** Converts an amount denominated in the peer's asset into this intent's asset. */
  convertPeerAmount(args: {
    sourceAmount: bigint;
    peerAssetCode: string;
    peerAssetScale: number;
    fxRate?: number;
  }): bigint {
    const { sourceAmount, peerAssetCode, peerAssetScale, fxRate } = args;
    if (peerAssetCode === this._assetCode) {
      const scaleDiff = this._assetScale - peerAssetScale;
      if (scaleDiff === 0) return sourceAmount;
      return BigInt(Math.floor(Number(sourceAmount) * 10 ** scaleDiff));
    }
    if (fxRate == null) {
      throw new MissingFxRateError(
        `Cross-asset inbound quote for ${this.id} requires an fxRate (peer: ${peerAssetCode}, intent: ${this._assetCode})`
      );
    }
    const scaleDiff = this._assetScale - peerAssetScale;
    return BigInt(Math.floor(Number(sourceAmount) * fxRate * 10 ** scaleDiff));
  }

  addLocalPayment(args: {
    id: string;
    quoteId?: string;
    grantId?: string;
    senderWalletAddress: {
      id: string;
      address: string;
      assetCode: string;
      assetScale: number;
    };
    exchangeRate: number;
    debitAmount?: bigint;
    metadata?: Record<string, unknown>;
  }): ISentPayment {
    const {
      id,
      senderWalletAddress,
      quoteId,
      grantId,
      debitAmount,
      exchangeRate: unscaledExchangeRate,
      metadata
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

    if (this._sentPayments.find((payment) => payment.id === id)) {
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
        this._sentPayments.find(
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

    const payment = SentPayment.create({
      id,
      senderWalletAddress: senderWalletAddress.address,
      senderWalletAddressId: senderWalletAddress.id,
      paymentIntentId: this.id,
      assetCode: senderWalletAddress.assetCode,
      assetScale: senderWalletAddress.assetScale,
      debitAmount: paymentDebitAmount,
      receiveAmount: paymentReceiveAmount,
      quoteId,
      grantId,
      metadata
    });

    this._sentPayments.push(payment);
    return payment.toObject();
  }

  addRemotePayment(args: {
    id: string;
    quoteId: string;
    grantId?: string;
    senderWalletAddress: {
      id: string;
      address: string;
      assetCode: string;
      assetScale: number;
    };
    metadata?: Record<string, unknown>;
  }): ISentPayment {
    const { id, quoteId, grantId, senderWalletAddress, metadata } = args;

    if (this._destination !== 'REMOTE') {
      throw new PaymentIntentInvalidState(
        'Payment intent destination must be remote'
      );
    }

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

    if (this._sentPayments.find((payment) => payment.id === id)) {
      throw new InvalidPaymentIdError(
        `Duplicate payment id ${id} exists for ${this.id} payment intent`
      );
    }

    const quote = this.quotes.find((q) => q.id === quoteId);
    if (!quote) {
      throw new InvalidQuoteIdError(
        `Could not find ${quoteId} quote for ${this.id} payment intent`
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

    if (
      this._sentPayments.find(
        (payment) =>
          payment.quoteId === quoteId && payment.state !== 'CANCELLED'
      )
    ) {
      throw new InvalidQuoteStateError(
        `Already consumed quote ${quoteId} for payment ${id}`
      );
    }

    const payment = SentPayment.create({
      id,
      senderWalletAddress: senderWalletAddress.address,
      senderWalletAddressId: senderWalletAddress.id,
      paymentIntentId: this.id,
      assetCode: senderWalletAddress.assetCode,
      assetScale: senderWalletAddress.assetScale,
      debitAmount: quote.debitAmount,
      receiveAmount: quote.receiveAmount,
      quoteId,
      grantId,
      metadata
    });

    this._sentPayments.push(payment);
    return payment.toObject();
  }

  approveRemotePaymentSend(args: { id: string }): ISentPayment {
    const { id } = args;

    if (this._destination !== 'REMOTE') {
      throw new PaymentIntentInvalidState(
        'Payment intent destination must be remote'
      );
    }

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

    const payment = this._sentPayments.find((p) => p.id === id);
    if (!payment) {
      throw new PaymentNotFoundError(
        `Payment ${id} not found for ${this.id} payment intent`
      );
    }

    payment.approveRemoteSend();
    return payment.toObject();
  }

  prepareRemotePayment(args: {
    id: string;
    ledgerTransferId: string;
  }): ISentPayment {
    const { id, ledgerTransferId } = args;

    const payment = this._sentPayments.find((p) => p.id === id);
    if (!payment) {
      throw new PaymentNotFoundError(
        `Payment ${id} not found for ${this.id} payment intent`
      );
    }

    payment.prepare(ledgerTransferId);
    return payment.toObject();
  }

  failRemotePayment(args: { id: string; reason?: string }): ISentPayment {
    const { id, reason } = args;

    const payment = this._sentPayments.find((p) => p.id === id);
    if (!payment) {
      throw new PaymentNotFoundError(
        `Payment ${id} not found for ${this.id} payment intent`
      );
    }

    payment.failRemote(reason);
    return payment.toObject();
  }

  confirmRemotePayment(args: { id: string }): ISentPayment {
    const { id } = args;

    const payment = this._sentPayments.find((p) => p.id === id);
    if (!payment) {
      throw new PaymentNotFoundError(
        `Payment ${id} not found for ${this.id} payment intent`
      );
    }

    payment.confirm();
    return payment.toObject();
  }

  rejectRemotePayment(args: { id: string; reason?: string }): ISentPayment {
    const { id, reason } = args;

    const payment = this._sentPayments.find((p) => p.id === id);
    if (!payment) {
      throw new PaymentNotFoundError(
        `Payment ${id} not found for ${this.id} payment intent`
      );
    }

    payment.reject(reason);
    return payment.toObject();
  }

  complete(): void {
    if (this.state !== 'CREATED') {
      throw new PaymentIntentInvalidState(
        `Payment intent is in an invalid state for completion: ${this.state}`
      );
    }

    if (this.isExpired) {
      throw new PaymentIntentExpired(
        `Payment intent is expired at: ${this.expiresAt.toISOString()}`
      );
    }

    if (this._destination !== 'LOCAL') {
      throw new PaymentIntentInvalidState(
        'Payment intent destination must be local to complete it'
      );
    }

    this._state = 'COMPLETED';
  }

  completeRemotePayment(args: { id: string }): ISentPayment {
    const { id } = args;

    const payment = this._sentPayments.find((p) => p.id === id);
    if (!payment) {
      throw new PaymentNotFoundError(
        `Payment ${id} not found for ${this.id} payment intent`
      );
    }

    const { receiveAmount } = payment.completeRemote();
    this._receivedAmount += receiveAmount;

    return payment.toObject();
  }

  completeLocalPayment(args: { id: string }): ISentPayment {
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

    const payment = this._sentPayments.find((p) => p.id === id);
    if (!payment) {
      throw new PaymentNotFoundError(
        `Payment ${id} not found for ${this.id} payment intent`
      );
    }

    // TODO: determine if we want to allow paying more than the incomingAmount.
    // For now, the logic is that we allow overpaying the incomingAmount once.

    const { receiveAmount } = payment.complete();
    this._receivedAmount += receiveAmount;

    if (this.isIncomingAmountMet) {
      this._state = 'COMPLETED';
    }
    return payment.toObject();
  }

  addInboundPayment(args: {
    id: string;
    packetId: string;
    peerId: string;
    peerAssetCode: string;
    peerAssetScale: number;
    sourceAmount: bigint;
    fxRate?: number;
    expiresAt?: Date;
  }): IInboundPayment {
    const { id, packetId, peerId, peerAssetCode, peerAssetScale, fxRate } =
      args;

    if (this._destination !== 'LOCAL') {
      throw new PaymentIntentInvalidState(
        'Payment intent destination must be local to receive a payment'
      );
    }

    if (this.state !== 'CREATED') {
      throw new PaymentIntentInvalidState(
        `Payment intent is in an invalid state for receiving payment: ${this.state}`
      );
    }

    if (this.isExpired) {
      throw new PaymentIntentExpired(
        `Payment intent is expired at: ${this.expiresAt.toISOString()}`
      );
    }

    if (this._inboundPayments.find((rp) => rp.id === id)) {
      throw new InvalidPaymentIdError(
        `Duplicate inbound payment id ${id} exists for ${this.id} payment intent`
      );
    }

    if (args.sourceAmount <= 0n) {
      throw new InvalidPaymentAmountError(
        `Inbound payment ${id} must have a positive sourceAmount`
      );
    }

    const receiveAmount = this.convertPeerAmount({
      sourceAmount: args.sourceAmount,
      peerAssetCode,
      peerAssetScale,
      fxRate
    });

    const inboundPayment = InboundPayment.create({
      id,
      paymentIntentId: this.id,
      packetId,
      peerId,
      peerAssetCode,
      peerAssetScale,
      sourceAmount: args.sourceAmount,
      receiveAmount,
      expiresAt: args.expiresAt
    });

    this._inboundPayments.push(inboundPayment);
    return inboundPayment.toObject();
  }

  acceptInboundPayment(args: {
    id: string;
    ledgerTransferId: string;
  }): IInboundPayment {
    const { id, ledgerTransferId } = args;

    const inboundPayment = this._inboundPayments.find((rp) => rp.id === id);
    if (!inboundPayment) {
      throw new PaymentNotFoundError(
        `Inbound payment ${id} not found for ${this.id} payment intent`
      );
    }

    inboundPayment.accept(ledgerTransferId);
    return inboundPayment.toObject();
  }

  failInboundPayment(args: { id: string; reason?: string }): IInboundPayment {
    const { id, reason } = args;

    const inboundPayment = this._inboundPayments.find((rp) => rp.id === id);
    if (!inboundPayment) {
      throw new PaymentNotFoundError(
        `Inbound payment ${id} not found for ${this.id} payment intent`
      );
    }

    inboundPayment.fail(reason);
    return inboundPayment.toObject();
  }

  markInboundPaymentFulfillable(args: { id: string }): IInboundPayment {
    const { id } = args;

    const inboundPayment = this._inboundPayments.find((rp) => rp.id === id);
    if (!inboundPayment) {
      throw new PaymentNotFoundError(
        `Inbound payment ${id} not found for ${this.id} payment intent`
      );
    }

    inboundPayment.markFulfillable();
    return inboundPayment.toObject();
  }

  finalizeInboundPayment(args: { id: string }): IInboundPayment {
    const { id } = args;

    const inboundPayment = this._inboundPayments.find((rp) => rp.id === id);
    if (!inboundPayment) {
      throw new PaymentNotFoundError(
        `Inbound payment ${id} not found for ${this.id} payment intent`
      );
    }

    const { receiveAmount } = inboundPayment.finalize();
    this._receivedAmount += receiveAmount;

    if (this.isIncomingAmountMet) {
      this._state = 'COMPLETED';
    }
    return inboundPayment.toObject();
  }

  cancelPayment(args: { id: string; reason?: string }): void {
    const { id, reason } = args;

    const payment = this._sentPayments.find((payment) => payment.id === id);
    if (!payment) {
      throw new PaymentNotFoundError(
        `Payment ${id} not found for ${this.id} payment intent`
      );
    }

    payment.cancel(reason);
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

  private get isIncomingAmountMet(): boolean {
    return (
      this._incomingAmount !== null &&
      this._receivedAmount >= this._incomingAmount
    );
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

  get sentPayments(): ISentPayment[] {
    return this._sentPayments.map((p) => p.toObject());
  }

  get inboundPayments(): IInboundPayment[] {
    return this._inboundPayments.map((rp) => rp.toObject());
  }

  get destinationIlpAddress(): string | undefined {
    return this._destinationIlpAddress;
  }

  get remoteUrl(): string | undefined {
    return this._remoteUrl;
  }

  get peerId(): string | undefined {
    return this._peerId;
  }

  get metadata(): Record<string, unknown> | undefined {
    return this._metadata;
  }
}
