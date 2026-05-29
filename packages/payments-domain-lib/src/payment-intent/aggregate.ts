import { ILogger, IMessage } from 'common-types-lib';
import {
  FinalizedRemoteQuoteUpdate,
  IPaymentIntent,
  IPaymentIntentRepository,
  IRatesService,
  IRemotePaymentIntentService,
  IWalletAddressService,
  PaymentIntentDestination,
  PaymentIntentState,
  PaymentState,
  IWalletAddress
} from './interfaces';
import { PaymentIntent } from './entity';
import {
  CreatePaymentIntentCmd,
  CreateQuoteCmd,
  CreatePaymentCmd,
  ApprovePaymentCmd,
  CompleteRemoteQuoteCmd,
  FailRemoteQuoteCmd
} from '../commands';
import {
  CannotCreateDuplicatePaymentIntentError,
  WalletAddressNotFoundError,
  WalletAddressInactiveError,
  PaymentIntentNotFoundError,
  PaymentIntentInvalidState,
  RatesError,
  MissingDestinationIlpAddressError
} from './errors';
import {
  QuoteCompletedEvent,
  QuoteCreateFailedEvent,
  PaymentIntentCreatedEvent,
  PaymentIntentCreateFailedEvent,
  PaymentCreateFailedEvent,
  LocalPaymentCompletedEvent,
  LocalPaymentCompleteFailedEvent,
  PaymentCreatedEvent,
  RemoteQuoteRequestedEvent
} from './events';

export class PaymentIntentAggregate {
  private newPaymentIntentIds: string[] = [];
  private newPaymentIntentQuotes = new Map<string, string[]>(); // paymentIntentId, quoteIds
  private newPaymentsMap = new Map<string, string[]>(); // paymentIntentId, paymentIds
  private completedLocalPayments = new Map<string, string[]>(); // paymentIntentId, paymentIds
  private finalizedRemoteQuotes = new Map<string, string[]>(); // paymentIntentId, quoteIds
  private paymentIntentMap = new Map<string, IPaymentIntent>();
  private walletAddressMap = new Map<string, IWalletAddress>();
  private remotePaymentIntentFetchErrors = new Map<string, Error>();

  constructor(
    private _repo: IPaymentIntentRepository,
    private _walletAddressService: IWalletAddressService,
    private _ratesService: IRatesService,
    private _remotePaymentIntentService: IRemotePaymentIntentService,
    private _logger: ILogger
  ) {}

  async handleBatch(cmds: IMessage[]): Promise<{ events: IMessage[] }> {
    this._logger.debug(`handleBatch — ${cmds.length} cmd(s)`);
    const outputEvents: IMessage[] = [];

    // prefetch any external data needed to process the batch
    const walletAddressIdSet = new Set<string>();
    const paymentIntentIdsSet = new Set<string>();
    const remoteUrlByProposedId = new Map<string, string>(); // proposed id -> url
    for (const cmd of cmds) {
      if (cmd.msgName === CreatePaymentIntentCmd.name) {
        const payload = (cmd as CreatePaymentIntentCmd).payload;
        walletAddressIdSet.add(payload.receiverWalletAddressId);
        paymentIntentIdsSet.add(payload.id);
      } else if (cmd.msgName === CreateQuoteCmd.name) {
        const payload = (cmd as CreateQuoteCmd).payload;
        walletAddressIdSet.add(payload.senderWalletAddressId);
        if (payload.remoteUrl) {
          remoteUrlByProposedId.set(payload.paymentIntentId, payload.remoteUrl);
        } else {
          paymentIntentIdsSet.add(payload.paymentIntentId);
        }
      } else if (cmd.msgName === CreatePaymentCmd.name) {
        const payload = (cmd as CreatePaymentCmd).payload;
        walletAddressIdSet.add(payload.senderWalletAddressId);
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === ApprovePaymentCmd.name) {
        const payload = (cmd as ApprovePaymentCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === CompleteRemoteQuoteCmd.name) {
        const payload = (cmd as CompleteRemoteQuoteCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === FailRemoteQuoteCmd.name) {
        const payload = (cmd as FailRemoteQuoteCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      }
    }

    const uniqueRemoteUrls = [...new Set(remoteUrlByProposedId.values())];
    const [walletAddresses, existingPaymentIntents, existingByUrl] =
      await Promise.all([
        this._walletAddressService.fetchByIds([...walletAddressIdSet]),
        this._repo.fetchByIdsWithPayments([...paymentIntentIdsSet]),
        this._repo.fetchIdsByRemoteUrls(uniqueRemoteUrls)
      ]);

    for (const walletAddress of walletAddresses) {
      this.walletAddressMap.set(walletAddress.id, walletAddress);
    }

    for (const paymentIntent of existingPaymentIntents) {
      this.paymentIntentMap.set(paymentIntent.id, paymentIntent);
    }

    await this._importRemotePaymentIntents(
      remoteUrlByProposedId,
      existingByUrl
    );

    for (const cmd of cmds) {
      let event: IMessage;
      if (cmd.msgName === CreatePaymentIntentCmd.name) {
        event = this.handleCreatePaymentIntentCommand(
          cmd as CreatePaymentIntentCmd
        );
      } else if (cmd.msgName === CreateQuoteCmd.name) {
        event = await this.handleCreateQuoteCommand(cmd as CreateQuoteCmd);
      } else if (cmd.msgName === CreatePaymentCmd.name) {
        event = await this.handleCreatePaymentCommand(cmd as CreatePaymentCmd);
      } else if (cmd.msgName === ApprovePaymentCmd.name) {
        event = await this.handleApprovePaymentCommand(
          cmd as ApprovePaymentCmd
        );
      } else if (cmd.msgName === CompleteRemoteQuoteCmd.name) {
        event = this.handleCompleteRemoteQuoteCommand(
          cmd as CompleteRemoteQuoteCmd
        );
      } else if (cmd.msgName === FailRemoteQuoteCmd.name) {
        event = this.handleFailRemoteQuoteCommand(cmd as FailRemoteQuoteCmd);
      } else {
        throw new Error('Unexpected command');
      }

      outputEvents.push(event);
    }

    return { events: outputEvents };
  }

  private handleCreatePaymentIntentCommand(cmd: CreatePaymentIntentCmd) {
    this._logger.debug(
      `handleCreatePaymentIntentCommand — id: ${cmd.payload.id} walletAddressId: ${cmd.payload.receiverWalletAddressId}`
    );
    try {
      const {
        id,
        receiverWalletAddressId,
        receiverWalletAddress,
        expiresAt,
        incomingAmount
      } = cmd.payload;

      if (this.paymentIntentMap.has(id)) {
        throw new CannotCreateDuplicatePaymentIntentError(
          `Payment intent with id ${id} already exists`
        );
      }

      const walletAddress = this.walletAddressMap.get(receiverWalletAddressId);
      if (!walletAddress) {
        throw new WalletAddressNotFoundError(
          `Wallet address ${receiverWalletAddressId} not found`
        );
      }
      if (!walletAddress.isActive) {
        throw new WalletAddressInactiveError(
          `Wallet address ${receiverWalletAddressId} is not active`
        );
      }

      // NOTE: Should we validate asset match if incomingAmount provided?
      // Currently incomingAmount on the command is a bare number.
      // Keep and use wallet address asset? Or require as means of confirming
      // the sender understands the asset to be used?
      // - v1 Rafiki requires it to be passed in

      const destination = PaymentIntentDestination.LOCAL;

      const entity = PaymentIntent.create(
        id,
        receiverWalletAddressId,
        receiverWalletAddress,
        destination,
        walletAddress.assetCode,
        walletAddress.assetScale,
        expiresAt ?? null,
        incomingAmount != null ? BigInt(incomingAmount) : null
      );

      this.paymentIntentMap.set(id, entity.toObject());
      this.newPaymentIntentIds.push(id);

      this._logger.debug(
        `handleCreatePaymentIntentCommand — created id: ${id}`
      );
      return new PaymentIntentCreatedEvent(
        {
          id: entity.id,
          createdAt: entity.createdAt,
          expiresAt: entity.expiresAt,
          incomingAmount: String(entity.incomingAmount),
          receivedAmount: String(entity.receivedAmount),
          state: entity.state,
          receiverWalletAddressId: entity.receiverWalletAddressId,
          assetCode: entity.assetCode,
          assetScale: entity.assetScale
        },
        cmd.requestId
      );
    } catch (err) {
      this._logger.debug(
        `handleCreatePaymentIntentCommand — failed id: ${cmd.payload.id} error: ${(err as Error).message}`
      );
      const event = new PaymentIntentCreateFailedEvent(
        {
          paymentIntentId: cmd.payload.id,
          errorName: (err as Error).constructor.name,
          message: (err as Error).message
        },
        cmd.requestId
      );

      return event;
    }
  }

  private async handleCreateQuoteCommand(cmd: CreateQuoteCmd) {
    this._logger.debug(
      `handleCreateQuoteCommand — quoteId: ${cmd.payload.id} paymentIntentId: ${cmd.payload.paymentIntentId}`
    );
    try {
      const {
        id: quoteId,
        senderWalletAddressId,
        senderWalletAddress,
        receiveAmount,
        debitAmount,
        paymentIntentId,
        remoteUrl
      } = cmd.payload;

      const walletAddress = this.walletAddressMap.get(senderWalletAddressId);
      if (!walletAddress) {
        throw new WalletAddressNotFoundError(
          `Wallet address ${senderWalletAddressId} not found`
        );
      }
      if (!walletAddress.isActive) {
        throw new WalletAddressInactiveError(
          `Wallet address ${senderWalletAddressId} is not active`
        );
      }

      if (remoteUrl) {
        const fetchError =
          this.remotePaymentIntentFetchErrors.get(paymentIntentId);
        if (fetchError) throw fetchError;
      }

      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      // NOTE: Do we check here if the receiving wallet address is deactivated?
      // Or is payment intent deactivation something that we could handle on a "wallet deactivated" event,
      // where we just mark all of the payment intents as EXPIRED/COMPLETED?

      // paymentIntent.id is authoritative from here — may differ from
      // paymentIntentId (proposed from cmd) when deduped to an existing id
      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);

      this._logger.debug(
        `handleCreateQuoteCommand — destination: ${paymentIntent.destination} paymentIntentId: ${paymentIntentId}`
      );

      if (paymentIntent.destination === 'LOCAL') {
        const exchangeRate = await this._ratesService.getRate(
          walletAddress.assetCode,
          paymentIntent.assetCode
        );

        if (!exchangeRate) {
          throw new RatesError('Could not get rates during quoting');
        }

        const completedQuote = paymentIntent.addLocalQuote({
          id: quoteId,
          senderWalletAddress: {
            id: senderWalletAddressId,
            address: senderWalletAddress,
            assetScale: walletAddress.assetScale,
            assetCode: walletAddress.assetCode
          },
          debitAmount: debitAmount ? BigInt(debitAmount) : undefined,
          receiveAmount: receiveAmount ? BigInt(receiveAmount) : undefined,
          exchangeRate
        });

        this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
        this._appendToMap(
          this.newPaymentIntentQuotes,
          paymentIntent.id,
          quoteId
        );

        this._logger.debug(
          `handleCreateQuoteCommand — LOCAL quote completed quoteId: ${quoteId}, paymentIntentId: ${paymentIntent.id}`
        );
        return new QuoteCompletedEvent(
          {
            id: quoteId,
            paymentIntentId: paymentIntent.id,
            senderWalletAddress: completedQuote.senderWalletAddress,
            senderWalletAddressId: completedQuote.senderWalletAddressId,
            expiresAt: completedQuote.expiresAt.toISOString(),
            debitAmount: String(completedQuote.debitAmount),
            receiveAmount: String(completedQuote.receiveAmount),
            exchangeRate: completedQuote.exchangeRate
          },
          cmd.requestId
        );
      }

      // REMOTE: create pending quote, emit event to initiate quoting
      const pendingQuote = paymentIntent.addPendingRemoteQuote({
        id: quoteId,
        senderWalletAddress: {
          id: senderWalletAddressId,
          address: senderWalletAddress
        },
        debitAmount: debitAmount ? BigInt(debitAmount) : undefined,
        receiveAmount: receiveAmount ? BigInt(receiveAmount) : undefined
      });

      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this._appendToMap(this.newPaymentIntentQuotes, paymentIntent.id, quoteId);

      const { destinationIlpAddress } = paymentIntent;
      if (!destinationIlpAddress) {
        throw new MissingDestinationIlpAddressError(
          `Payment intent ${paymentIntentId} is missing destinationIlpAddress`
        );
      }

      this._logger.debug(
        `handleCreateQuoteCommand — REMOTE quote pending quoteId: ${quoteId} destinationIlpAddress: ${destinationIlpAddress}`
      );
      return new RemoteQuoteRequestedEvent(
        {
          paymentIntentId: paymentIntent.id,
          quoteId,
          senderWalletAddress,
          receiverWalletAddress: paymentIntent.receiverWalletAddress,
          senderAssetCode: walletAddress.assetCode,
          senderAssetScale: walletAddress.assetScale,
          receiverAssetCode: paymentIntent.assetCode,
          receiverAssetScale: paymentIntent.assetScale,
          debitAmount: pendingQuote.debitAmount?.toString(),
          receiveAmount: pendingQuote.receiveAmount?.toString(),
          destinationIlpAddress
        },
        cmd.requestId
      );
    } catch (err) {
      this._logger.debug(
        `handleCreateQuoteCommand — failed paymentIntentId: ${cmd.payload.paymentIntentId} error: ${(err as Error).message}`
      );
      return new QuoteCreateFailedEvent(
        {
          paymentIntentId: cmd.payload.paymentIntentId,
          errorName: (err as Error).constructor.name,
          message: (err as Error).message
        },
        cmd.requestId
      );
    }
  }

  private async handleCreatePaymentCommand(cmd: CreatePaymentCmd) {
    this._logger.debug(
      `handleCreatePaymentCommand — paymentId: ${cmd.payload.id} paymentIntentId: ${cmd.payload.paymentIntentId} quoteId: ${cmd.payload.quoteId}`
    );
    const {
      id: paymentId,
      senderWalletAddressId,
      senderWalletAddress,
      paymentIntentId,
      quoteId,
      debitAmount
    } = cmd.payload;

    try {
      const walletAddress = this.walletAddressMap.get(senderWalletAddressId);
      if (!walletAddress) {
        throw new WalletAddressNotFoundError(
          `Wallet address ${senderWalletAddressId} not found`
        );
      }
      if (!walletAddress.isActive) {
        throw new WalletAddressInactiveError(
          `Wallet address ${senderWalletAddressId} is not active`
        );
      }

      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);

      if (paymentIntent.destination !== 'LOCAL') {
        throw new PaymentIntentInvalidState(
          'Payment intent destination must be local'
        );
      }

      const exchangeRate = await this._ratesService.getRate(
        walletAddress.assetCode,
        paymentIntent.assetCode
      );

      if (!exchangeRate) {
        throw new RatesError('Could not get rates during quoting');
      }

      const payment = paymentIntent.addLocalPayment({
        id: paymentId,
        senderWalletAddress: {
          id: senderWalletAddressId,
          address: senderWalletAddress,
          assetScale: walletAddress.assetScale,
          assetCode: walletAddress.assetCode
        },
        exchangeRate,
        quoteId,
        debitAmount: debitAmount ? BigInt(debitAmount) : undefined
      });

      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this._appendToMap(this.newPaymentsMap, paymentIntent.id, paymentId);

      this._logger.debug(
        `handleCreatePaymentCommand — created paymentId: ${paymentId}`
      );

      return new PaymentCreatedEvent(
        {
          id: payment.id,
          paymentIntentId: payment.paymentIntentId,
          senderWalletAddress: payment.senderWalletAddress,
          debitAmount: String(payment.debitAmount),
          receiveAmount: String(payment.receiveAmount),
          sentAmount: String(payment.sentAmount),
          state: payment.state,
          createdAt: payment.createdAt,
          assetCode: payment.assetCode,
          assetScale: payment.assetScale,
          receiveAssetCode: paymentIntent.assetCode,
          receiveAssetScale: paymentIntent.assetScale
        },
        cmd.requestId
      );
    } catch (err) {
      this._logger.debug(
        `handleCreatePaymentCommand — failed paymentIntentId: ${cmd.payload.paymentIntentId} error: ${(err as Error).message}`
      );
      const event = new PaymentCreateFailedEvent(
        {
          paymentIntentId: cmd.payload.paymentIntentId,
          errorName: (err as Error).constructor.name,
          message: (err as Error).message
        },
        cmd.requestId
      );

      return event;
    }
  }

  private handleCompleteRemoteQuoteCommand(cmd: CompleteRemoteQuoteCmd) {
    this._logger.debug(
      `handleCompleteRemoteQuoteCommand — quoteId: ${cmd.payload.quoteId} paymentIntentId: ${cmd.payload.paymentIntentId}`
    );
    const {
      quoteId,
      paymentIntentId,
      maxSourceAmount,
      minDeliveryAmount,
      lowEstimatedExchangeRate
    } = cmd.payload;

    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);

      const completedQuote = paymentIntent.completeRemoteQuote({
        id: quoteId,
        debitAmount: BigInt(maxSourceAmount),
        receiveAmount: BigInt(minDeliveryAmount),
        exchangeRate: lowEstimatedExchangeRate
      });

      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this._appendToMap(this.finalizedRemoteQuotes, paymentIntent.id, quoteId);

      return new QuoteCompletedEvent(
        {
          id: quoteId,
          paymentIntentId,
          senderWalletAddress: completedQuote.senderWalletAddress,
          senderWalletAddressId: completedQuote.senderWalletAddressId,
          expiresAt: completedQuote.expiresAt.toISOString(),
          debitAmount: String(completedQuote.debitAmount),
          receiveAmount: String(completedQuote.receiveAmount),
          exchangeRate: completedQuote.exchangeRate
        },
        cmd.requestId
      );
    } catch (err) {
      return new QuoteCreateFailedEvent(
        {
          paymentIntentId: cmd.payload.paymentIntentId,
          errorName: (err as Error).constructor.name,
          message: (err as Error).message
        },
        cmd.requestId
      );
    }
  }

  private handleFailRemoteQuoteCommand(cmd: FailRemoteQuoteCmd) {
    this._logger.debug(
      `handleFailRemoteQuoteCommand — quoteId: ${cmd.payload.quoteId} paymentIntentId: ${cmd.payload.paymentIntentId} error: ${cmd.payload.message}`
    );
    const { quoteId, paymentIntentId, errorName, message } = cmd.payload;

    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);

      paymentIntent.failRemoteQuote({ id: quoteId, errorName, message });

      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this._appendToMap(this.finalizedRemoteQuotes, paymentIntent.id, quoteId);

      return new QuoteCreateFailedEvent(
        { paymentIntentId, errorName, message },
        cmd.requestId
      );
    } catch (err) {
      return new QuoteCreateFailedEvent(
        {
          paymentIntentId,
          errorName: (err as Error).constructor.name,
          message: (err as Error).message
        },
        cmd.requestId
      );
    }
  }

  private async handleApprovePaymentCommand(cmd: ApprovePaymentCmd) {
    this._logger.debug(
      `handleApprovePaymentCommand — paymentId: ${cmd.payload.id} paymentIntentId: ${cmd.payload.paymentIntentId}`
    );
    const { id: paymentId, paymentIntentId } = cmd.payload;

    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);

      if (paymentIntent.destination !== 'LOCAL') {
        throw new PaymentIntentInvalidState(
          'Payment intent destination must be local'
        );
      }

      paymentIntent.completeLocalPayment({ id: paymentId });
      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this._appendToMap(
        this.completedLocalPayments,
        paymentIntent.id,
        paymentId
      );

      return new LocalPaymentCompletedEvent({ id: paymentId }, cmd.requestId);
    } catch (err) {
      return new LocalPaymentCompleteFailedEvent(
        {
          paymentIntentId: cmd.payload.paymentIntentId,
          errorName: (err as Error).constructor.name,
          message: (err as Error).message
        },
        cmd.requestId
      );
    }
  }

  private async _importRemotePaymentIntents(
    remoteUrlByProposedId: Map<string, string>,
    existingByUrl: Array<{ id: string; remoteUrl: string }>
  ): Promise<void> {
    if (remoteUrlByProposedId.size === 0) return;

    // map url to existing DB id for cross-batch dedup
    const dbIdByUrl = new Map<string, string>();
    for (const { id, remoteUrl } of existingByUrl) {
      dbIdByUrl.set(remoteUrl, id);
    }

    // load existing intents from DB that weren't already prefetched by their own ID
    const dbIdsToLoad = [...new Set(dbIdByUrl.values())].filter(
      (id) => !this.paymentIntentMap.has(id)
    );
    if (dbIdsToLoad.length > 0) {
      const loaded = await this._repo.fetchByIdsWithPayments(dbIdsToLoad);
      for (const intent of loaded) {
        this.paymentIntentMap.set(intent.id, intent);
      }
    }

    // map url to an authoritative ID for inter-batch dedupe.
    // for new URLs, first proposed ID in the batch becomes the intent's ID.
    const canonicalIdByUrl = new Map<string, string>();
    for (const [proposedId, url] of remoteUrlByProposedId) {
      if (!dbIdByUrl.has(url) && !canonicalIdByUrl.has(url)) {
        canonicalIdByUrl.set(url, proposedId);
      }
    }

    // fetch the payment intents
    const fetchResults = await Promise.all(
      [...canonicalIdByUrl.entries()].map(async ([url, canonicalId]) => {
        this._logger.debug(
          `_importRemotePaymentIntents — fetching url: ${url} canonicalId: ${canonicalId}`
        );
        try {
          const remotePaymentIntent =
            await this._remotePaymentIntentService.fetchIncomingPayment(url);
          this._logger.debug(
            `_importRemotePaymentIntents — fetched url: ${url} assetCode: ${remotePaymentIntent.assetCode}`
          );
          return { canonicalId, url, remotePaymentIntent, error: null };
        } catch (err) {
          this._logger.debug(
            `_importRemotePaymentIntents — fetch failed url: ${url} error: ${(err as Error).message}`
          );
          return {
            canonicalId,
            url,
            remotePaymentIntent: null,
            error: err as Error
          };
        }
      })
    );

    for (const {
      canonicalId,
      url,
      remotePaymentIntent,
      error
    } of fetchResults) {
      if (error) {
        this.remotePaymentIntentFetchErrors.set(canonicalId, error);
      } else {
        const entity = PaymentIntent.create(
          canonicalId,
          undefined,
          remotePaymentIntent.walletAddress,
          PaymentIntentDestination.REMOTE,
          remotePaymentIntent.assetCode,
          remotePaymentIntent.assetScale,
          remotePaymentIntent.expiresAt ?? null,
          remotePaymentIntent.incomingAmount ?? null,
          remotePaymentIntent.receivedAmount,
          remotePaymentIntent.destinationIlpAddress,
          url
        );
        this.paymentIntentMap.set(canonicalId, entity.toObject());
        this.newPaymentIntentIds.push(canonicalId);
      }
    }

    // alias every duplicate proposed ID to the resolved intent/error so the
    // handler can look up using the proposed (but ultimately discarded) ID from the command
    for (const [proposedId, url] of remoteUrlByProposedId) {
      const resolvedId = dbIdByUrl.get(url) ?? canonicalIdByUrl.get(url);
      if (!resolvedId || resolvedId === proposedId) continue;

      const resolvedIntent = this.paymentIntentMap.get(resolvedId);
      if (resolvedIntent) {
        this.paymentIntentMap.set(proposedId, resolvedIntent);
      }
      const resolvedError = this.remotePaymentIntentFetchErrors.get(resolvedId);
      if (resolvedError) {
        this.remotePaymentIntentFetchErrors.set(proposedId, resolvedError);
      }
    }
  }

  private _appendToMap(
    map: Map<string, string[]>,
    paymentIntentId: string,
    idToAppend: string
  ) {
    if (!map.has(paymentIntentId)) {
      map.set(paymentIntentId, []);
    }

    map.get(paymentIntentId)?.push(idToAppend);
  }

  public async flush() {
    const promises = [];

    if (this.newPaymentIntentIds.length > 0) {
      const newEntities = [];
      for (const id of this.newPaymentIntentIds) {
        const paymentIntent = this.paymentIntentMap.get(id);
        if (!paymentIntent) {
          this._logger.error(
            `Payment intent ${id} missing from paymentIntentMap during flush (payment intents)`
          );
          continue;
        }

        newEntities.push(paymentIntent);
      }

      promises.push(this._repo.storeMany(newEntities));
    }

    if (this.newPaymentIntentQuotes.size > 0) {
      const updates: {
        paymentIntent: IPaymentIntent;
        quoteIds: string[];
      }[] = [];
      for (const [
        paymentIntentId,
        quoteIds
      ] of this.newPaymentIntentQuotes.entries()) {
        const paymentIntent = this.paymentIntentMap.get(paymentIntentId);
        if (!paymentIntent) {
          this._logger.error(
            `Payment intent ${paymentIntentId} missing from paymentIntentMap during flush (quotes)`
          );
          continue;
        }

        updates.push({ paymentIntent, quoteIds });
      }

      promises.push(this._repo.storeQuotes(updates));
    }

    if (this.newPaymentsMap.size > 0) {
      const updates: {
        paymentIntent: IPaymentIntent;
        paymentIds: string[];
      }[] = [];
      for (const [
        paymentIntentId,
        paymentIds
      ] of this.newPaymentsMap.entries()) {
        const paymentIntent = this.paymentIntentMap.get(paymentIntentId);
        if (!paymentIntent) {
          this._logger.error(
            `Payment intent ${paymentIntentId} missing from paymentIntentMap during flush (payments)`
          );
          continue;
        }

        updates.push({ paymentIntent, paymentIds });
      }

      promises.push(this._repo.storePayments(updates));
    }

    if (this.completedLocalPayments.size > 0) {
      const updates: {
        paymentIntent: {
          id: string;
          receivedAmount: bigint;
          state: PaymentIntentState;
        };
        payments: { id: string; state: PaymentState; sentAmount: bigint }[];
      }[] = [];

      for (const [
        paymentIntentId,
        paymentIds
      ] of this.completedLocalPayments.entries()) {
        const paymentIntent = this.paymentIntentMap.get(paymentIntentId);
        if (!paymentIntent) {
          this._logger.error(
            `Payment intent ${paymentIntentId} missing from paymentIntentMap during flush (payments)`
          );
          continue;
        }

        updates.push({
          paymentIntent: {
            id: paymentIntent.id,
            state: paymentIntent.state,
            receivedAmount: paymentIntent.receivedAmount
          },
          payments: paymentIntent.payments
            .filter((p) => paymentIds.includes(p.id))
            .map((p) => ({
              id: p.id,
              state: p.state,
              sentAmount: p.sentAmount
            }))
        });
      }

      promises.push(this._repo.storeCompletedLocalPayments(updates));
    }

    if (this.finalizedRemoteQuotes.size > 0) {
      const updates: FinalizedRemoteQuoteUpdate[] = [];

      for (const [
        paymentIntentId,
        quoteIds
      ] of this.finalizedRemoteQuotes.entries()) {
        const paymentIntent = this.paymentIntentMap.get(paymentIntentId);
        if (!paymentIntent) {
          this._logger.error(
            `Payment intent ${paymentIntentId} missing from paymentIntentMap during flush (finalized remote quotes)`
          );
          continue;
        }

        for (const quoteId of quoteIds) {
          const quote = paymentIntent.quotes.find((q) => q.id === quoteId);
          if (!quote) {
            this._logger.error(
              `Quote ${quoteId} missing from paymentIntentMap during flush`
            );
            continue;
          }
          if (quote.state === 'COMPLETED') {
            updates.push({
              paymentIntentId,
              quoteId,
              state: 'COMPLETED',
              debitAmount: quote.debitAmount,
              receiveAmount: quote.receiveAmount,
              exchangeRate: quote.exchangeRate,
              expiresAt: quote.expiresAt
            });
          } else if (quote.state === 'FAILED') {
            updates.push({
              paymentIntentId,
              quoteId,
              state: 'FAILED',
              errorName: quote.errorName,
              message: quote.message
            });
          } else {
            this._logger.error(
              `Quote ${quoteId} has unexpected state "${quote.state}" during flush`
            );
          }
        }
      }

      promises.push(this._repo.storeFinalizedRemoteQuotes(updates));
    }

    // TODO handle gracefully
    try {
      await Promise.all(promises);
    } finally {
      this.paymentIntentMap.clear();
      this.walletAddressMap.clear(); // TODO: wallet addresses are OK to be cached
      this.newPaymentsMap.clear();
      this.completedLocalPayments.clear();
      this.finalizedRemoteQuotes.clear();
      this.newPaymentIntentQuotes.clear();
      this.newPaymentIntentIds = [];
      this.remotePaymentIntentFetchErrors.clear();
    }
  }
}
