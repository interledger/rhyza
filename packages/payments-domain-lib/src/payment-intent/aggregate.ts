import { getErrorDetails, ILogger, IMessage } from 'common-types-lib';
import {
  FinalizedRemoteQuoteUpdate,
  IFxRateRequest,
  IPalService,
  IPeer,
  ISentPayment,
  isRemoteSentPayment,
  IRemoteSentPayment,
  IPaymentIntent,
  IPaymentIntentRepository,
  IRemotePaymentIntentService,
  PaymentIntentDestination,
  PaymentIntentState,
  SentPaymentState,
  InboundPaymentState,
  IWalletAddress
} from './interfaces';
import { PaymentIntent } from './entity';
import {
  CreatePaymentIntentCmd,
  CompletePaymentIntentCmd,
  CreateQuoteCmd,
  CreatePaymentCmd,
  ApprovePaymentCmd,
  CancelPaymentCmd,
  CompleteRemoteQuoteCmd,
  FailRemoteQuoteCmd,
  CalculateRemoteQuoteCmd,
  PrepareRemotePaymentCmd,
  FailRemotePaymentCmd,
  ConfirmRemotePaymentCmd,
  RejectRemotePaymentCmd,
  CompleteRemotePaymentCmd,
  ValidateInboundPaymentCmd,
  AcceptInboundPaymentCmd,
  FailInboundPaymentCmd,
  MarkInboundPaymentFulfillableCmd,
  FinalizeInboundPaymentCmd,
  ExpirePaymentIntentCmd,
  ExpirePaymentCmd
} from '../commands';
import {
  CannotCreateDuplicatePaymentIntentError,
  WalletAddressNotFoundError,
  WalletAddressInactiveError,
  PaymentIntentNotFoundError,
  PaymentNotFoundError,
  RatesError,
  MissingDestinationIlpAddressError,
  PeerNotFoundError,
  InvalidPaymentAmountError,
  InvalidQuoteStateError,
  InvalidQuoteIdError
} from './errors';
import {
  QuoteCompletedEvent,
  QuoteCreateFailedEvent,
  PaymentIntentCreatedEvent,
  PaymentIntentCreateFailedEvent,
  PaymentCreateFailedEvent,
  PaymentCompletedEvent,
  PaymentCompleteFailedEvent,
  PaymentCreatedEvent,
  RemoteQuoteRequestedEvent,
  RemoteQuoteCalculatedEvent,
  RemoteQuoteCalculationFailedEvent,
  PaymentIntentCompletedEvent,
  PaymentIntentCompleteFailedEvent,
  PaymentCancelFailedEvent,
  PaymentCancelledEvent,
  RemotePaymentSendApprovedEvent,
  RemotePaymentPreparedEvent,
  PaymentFailedEvent,
  RemotePaymentSendConfirmedEvent,
  RemotePaymentSendRejectedEvent,
  InboundPaymentValidatedEvent,
  InboundPaymentFulfillableEvent,
  InboundPaymentValidationFailedEvent,
  InboundPaymentAcceptedEvent,
  InboundPaymentFailedEvent,
  InboundPaymentFinalizedEvent,
  PaymentIntentCompletedPayload,
  PaymentCompleteFailedAdditionalData,
  PaymentIntentExpiredEvent,
  PaymentIntentExpireFailedEvent,
  PaymentExpiredEvent,
  PaymentExpireFailedEvent
} from 'payments-public-types-lib';

const fxKey = (
  peerId: string,
  direction: 'source' | 'destination',
  assetCode: string
) => `${peerId}:${direction}:${assetCode}`;

const intraFxKey = (sourceAssetCode: string, destinationAssetCode: string) =>
  `INTRA:${sourceAssetCode}:${destinationAssetCode}`;

export class PaymentIntentAggregate {
  private newPaymentIntentIds: string[] = [];
  private completedPaymentIntentIds: string[] = [];
  private newPaymentIntentQuotes = new Map<string, string[]>(); // paymentIntentId, quoteIds
  private newSentPaymentsMap = new Map<string, string[]>(); // paymentIntentId, paymentIds
  private completedLocalPayments = new Map<string, string[]>(); // paymentIntentId, paymentIds
  private approvedRemotePayments = new Map<string, string[]>(); // paymentIntentId, paymentIds
  private sendingRemotePayments = new Map<string, string[]>(); // paymentIntentId, paymentIds
  private confirmedRemotePayments = new Map<string, string[]>(); // paymentIntentId, paymentIds
  private rejectedRemotePayments = new Map<string, string[]>(); // paymentIntentId, paymentIds
  private completedRemotePayments = new Map<string, string[]>(); // paymentIntentId, paymentIds
  private failedRemotePayments = new Map<string, string[]>(); // paymentIntentId, paymentIds
  private cancelledPayments = new Map<string, string[]>(); // paymentIntentId, paymentIds
  private newInboundPayments = new Map<string, string[]>(); // paymentIntentId, inboundPaymentIds
  private acceptedInboundPayments = new Map<string, string[]>(); // paymentIntentId, inboundPaymentIds
  private failedInboundPayments = new Map<string, string[]>(); // paymentIntentId, inboundPaymentIds
  private fulfillableInboundPayments = new Map<string, string[]>(); // paymentIntentId, inboundPaymentIds
  private finalizedInboundPayments = new Map<string, string[]>(); // paymentIntentId, inboundPaymentIds
  private finalizedRemoteQuotes = new Map<string, string[]>(); // paymentIntentId, quoteIds
  private paymentIntentMap = new Map<string, IPaymentIntent>();
  private walletAddressMap = new Map<string, IWalletAddress>();
  private remotePaymentIntentFetchErrors = new Map<string, Error>();
  private peerMap = new Map<string, IPeer | null>(); // ilpAddress, peer
  private peerFetchErrors = new Map<string, Error>(); // ilpAddress, error
  private peersById = new Map<string, IPeer | null>(); // peerId, peer
  private peerByIdFetchErrors = new Map<string, Error>(); // peerId, error
  private fxRateMap = new Map<string, number | null>(); // fxKey, rate
  private fxRateFetchErrors = new Map<string, Error>(); // fxKey, error

  constructor(
    private _repo: IPaymentIntentRepository,
    private _palService: IPalService,
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
      } else if (cmd.msgName === CompletePaymentIntentCmd.name) {
        const payload = (cmd as CompletePaymentIntentCmd).payload;
        paymentIntentIdsSet.add(payload.id);
      } else if (cmd.msgName === CreateQuoteCmd.name) {
        const payload = (cmd as CreateQuoteCmd).payload;
        walletAddressIdSet.add(payload.senderWalletAddressId);
        if (payload.remotePaymentIntentUrl) {
          remoteUrlByProposedId.set(
            payload.paymentIntentId,
            payload.remotePaymentIntentUrl
          );
        } else {
          paymentIntentIdsSet.add(payload.paymentIntentId);
        }
      } else if (cmd.msgName === CreatePaymentCmd.name) {
        const payload = (cmd as CreatePaymentCmd).payload;
        walletAddressIdSet.add(payload.senderWalletAddressId);
        if (payload.remotePaymentIntentUrl) {
          remoteUrlByProposedId.set(
            payload.paymentIntentId,
            payload.remotePaymentIntentUrl
          );
        } else {
          paymentIntentIdsSet.add(payload.paymentIntentId);
        }
      } else if (cmd.msgName === ApprovePaymentCmd.name) {
        const payload = (cmd as ApprovePaymentCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === CancelPaymentCmd.name) {
        const payload = (cmd as CancelPaymentCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === CompleteRemoteQuoteCmd.name) {
        const payload = (cmd as CompleteRemoteQuoteCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === FailRemoteQuoteCmd.name) {
        const payload = (cmd as FailRemoteQuoteCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === CalculateRemoteQuoteCmd.name) {
        const payload = (cmd as CalculateRemoteQuoteCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === PrepareRemotePaymentCmd.name) {
        const payload = (cmd as PrepareRemotePaymentCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === FailRemotePaymentCmd.name) {
        const payload = (cmd as FailRemotePaymentCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === ConfirmRemotePaymentCmd.name) {
        const payload = (cmd as ConfirmRemotePaymentCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === RejectRemotePaymentCmd.name) {
        const payload = (cmd as RejectRemotePaymentCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === CompleteRemotePaymentCmd.name) {
        const payload = (cmd as CompleteRemotePaymentCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === ValidateInboundPaymentCmd.name) {
        const payload = (cmd as ValidateInboundPaymentCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === AcceptInboundPaymentCmd.name) {
        const payload = (cmd as AcceptInboundPaymentCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === FailInboundPaymentCmd.name) {
        const payload = (cmd as FailInboundPaymentCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === MarkInboundPaymentFulfillableCmd.name) {
        const payload = (cmd as MarkInboundPaymentFulfillableCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === FinalizeInboundPaymentCmd.name) {
        const payload = (cmd as FinalizeInboundPaymentCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === ExpirePaymentIntentCmd.name) {
        const payload = (cmd as ExpirePaymentIntentCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === ExpirePaymentCmd.name) {
        const payload = (cmd as ExpirePaymentCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      }
    }

    const uniqueRemoteUrls = [...new Set(remoteUrlByProposedId.values())];
    const [walletAddresses, existingPaymentIntents, existingByUrl] =
      await Promise.all([
        this._palService.getWalletAddresses([...walletAddressIdSet]),
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

    // second prefetch pass: peers + FX rates. Must come after all intent
    // prefetching (local read, remote import)

    // Resolve inbound peers by id first
    const peerIdsToFetch = new Set<string>();
    for (const cmd of cmds) {
      if (cmd.msgName === CalculateRemoteQuoteCmd.name) {
        peerIdsToFetch.add((cmd as CalculateRemoteQuoteCmd).payload.peerId);
      } else if (cmd.msgName === ValidateInboundPaymentCmd.name) {
        peerIdsToFetch.add((cmd as ValidateInboundPaymentCmd).payload.peerId);
      }
    }
    await Promise.all(
      Array.from(peerIdsToFetch, async (peerId) => {
        try {
          this.peersById.set(
            peerId,
            await this._palService.getPeerById(peerId)
          );
        } catch (err) {
          this.peerByIdFetchErrors.set(peerId, err as Error);
        }
      })
    );

    const ilpAddressesToFetch = new Set<string>();
    const fxToFetch = new Map<string, IFxRateRequest>();

    for (const cmd of cmds) {
      if (cmd.msgName === CreateQuoteCmd.name) {
        const quoteCmd = cmd as CreateQuoteCmd;
        this._collectIlpAddress(quoteCmd, ilpAddressesToFetch);
        this._collectIntraAseFxLookup(
          quoteCmd.payload.paymentIntentId,
          quoteCmd.payload.senderWalletAddressId,
          fxToFetch
        );
      } else if (cmd.msgName === CreatePaymentCmd.name) {
        const paymentCmd = cmd as CreatePaymentCmd;
        // Quoteless remote payments resolve the peer at creation (the quote
        // path binds it via addPendingRemoteQuote instead).
        this._collectIlpAddress(paymentCmd, ilpAddressesToFetch);
        this._collectIntraAseFxLookup(
          paymentCmd.payload.paymentIntentId,
          paymentCmd.payload.senderWalletAddressId,
          fxToFetch
        );
      } else if (cmd.msgName === CompleteRemoteQuoteCmd.name) {
        this._collectFxLookup(cmd as CompleteRemoteQuoteCmd, fxToFetch);
      } else if (cmd.msgName === CalculateRemoteQuoteCmd.name) {
        const payload = (cmd as CalculateRemoteQuoteCmd).payload;
        this._collectInboundFxLookup(
          payload,
          this.peersById.get(payload.peerId)?.assetCode,
          fxToFetch
        );
      } else if (cmd.msgName === ValidateInboundPaymentCmd.name) {
        // Peer asset (and thus the FX lookup) is resolved from PAL by peerId,
        // prefetched into peersById above — mirrors the CalculateRemoteQuoteCmd
        // case; the asset is not carried on the command.
        const payload = (cmd as ValidateInboundPaymentCmd).payload;
        this._collectInboundFxLookup(
          payload,
          this.peersById.get(payload.peerId)?.assetCode,
          fxToFetch
        );
      }
    }

    await Promise.all([
      ...Array.from(ilpAddressesToFetch, async (ilpAddress) => {
        try {
          // STREAM destinations are <serverAddress>.<connectionToken>; peer ILP
          // address is the serverAddress prefix (everything but the last segment).
          const staticAddress = ilpAddress.split('.').slice(0, -1).join('.');
          const peer =
            await this._palService.getPeerByIlpAddress(staticAddress);
          this.peerMap.set(ilpAddress, peer);
        } catch (err) {
          this.peerFetchErrors.set(ilpAddress, err as Error);
        }
      }),
      ...Array.from(fxToFetch.entries(), async ([key, request]) => {
        try {
          const rate = await this._palService.getRates(request);
          this.fxRateMap.set(key, rate ?? null);
        } catch (err) {
          this.fxRateFetchErrors.set(key, err as Error);
        }
      })
    ]);

    for (const cmd of cmds) {
      let event: IMessage | IMessage[];
      if (cmd.msgName === CreatePaymentIntentCmd.name) {
        event = this.handleCreatePaymentIntentCommand(
          cmd as CreatePaymentIntentCmd
        );
      } else if (cmd.msgName === CompletePaymentIntentCmd.name) {
        event = this.handleCompletePaymentIntentCommand(
          cmd as CompletePaymentIntentCmd
        );
      } else if (cmd.msgName === CreateQuoteCmd.name) {
        event = await this.handleCreateQuoteCommand(cmd as CreateQuoteCmd);
      } else if (cmd.msgName === CreatePaymentCmd.name) {
        event = await this.handleCreatePaymentCommand(cmd as CreatePaymentCmd);
      } else if (cmd.msgName === ApprovePaymentCmd.name) {
        event = await this.handleApprovePaymentCommand(
          cmd as ApprovePaymentCmd
        );
      } else if (cmd.msgName === CancelPaymentCmd.name) {
        event = await this.handleCancelPaymentCommand(cmd as CancelPaymentCmd);
      } else if (cmd.msgName === CompleteRemoteQuoteCmd.name) {
        event = await this.handleCompleteRemoteQuoteCommand(
          cmd as CompleteRemoteQuoteCmd
        );
      } else if (cmd.msgName === FailRemoteQuoteCmd.name) {
        event = this.handleFailRemoteQuoteCommand(cmd as FailRemoteQuoteCmd);
      } else if (cmd.msgName === CalculateRemoteQuoteCmd.name) {
        event = this.handleCalculateRemoteQuoteCommand(
          cmd as CalculateRemoteQuoteCmd
        );
      } else if (cmd.msgName === PrepareRemotePaymentCmd.name) {
        event = await this.handlePrepareRemotePaymentCommand(
          cmd as PrepareRemotePaymentCmd
        );
      } else if (cmd.msgName === FailRemotePaymentCmd.name) {
        event = this.handleFailRemotePaymentCommand(
          cmd as FailRemotePaymentCmd
        );
      } else if (cmd.msgName === ConfirmRemotePaymentCmd.name) {
        event = this.handleConfirmRemotePaymentCommand(
          cmd as ConfirmRemotePaymentCmd
        );
      } else if (cmd.msgName === RejectRemotePaymentCmd.name) {
        event = this.handleRejectRemotePaymentCommand(
          cmd as RejectRemotePaymentCmd
        );
      } else if (cmd.msgName === CompleteRemotePaymentCmd.name) {
        event = this.handleCompleteRemotePaymentCommand(
          cmd as CompleteRemotePaymentCmd
        );
      } else if (cmd.msgName === ValidateInboundPaymentCmd.name) {
        event = this.handleValidateInboundPaymentCommand(
          cmd as ValidateInboundPaymentCmd
        );
      } else if (cmd.msgName === AcceptInboundPaymentCmd.name) {
        event = this.handleAcceptInboundPaymentCommand(
          cmd as AcceptInboundPaymentCmd
        );
      } else if (cmd.msgName === FailInboundPaymentCmd.name) {
        event = this.handleFailInboundPaymentCommand(
          cmd as FailInboundPaymentCmd
        );
      } else if (cmd.msgName === MarkInboundPaymentFulfillableCmd.name) {
        event = this.handleMarkInboundPaymentFulfillableCommand(
          cmd as MarkInboundPaymentFulfillableCmd
        );
      } else if (cmd.msgName === FinalizeInboundPaymentCmd.name) {
        event = this.handleFinalizeInboundPaymentCommand(
          cmd as FinalizeInboundPaymentCmd
        );
      } else if (cmd.msgName === ExpirePaymentIntentCmd.name) {
        event = this.handleExpirePaymentIntentCommand(
          cmd as ExpirePaymentIntentCmd
        );
      } else if (cmd.msgName === ExpirePaymentCmd.name) {
        event = this.handleExpirePaymentCommand(cmd as ExpirePaymentCmd);
      } else {
        throw new Error('Unexpected command');
      }
      const events = Array.isArray(event) ? event : [event];
      outputEvents.push(...events);
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
        incomingAmount,
        metadata
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
        incomingAmount != null ? BigInt(incomingAmount) : null,
        undefined,
        undefined,
        undefined,
        metadata ? JSON.parse(metadata) : undefined
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
          incomingAmount:
            entity.incomingAmount != null
              ? String(entity.incomingAmount)
              : null,
          receivedAmount: String(entity.receivedAmount),
          state: entity.state,
          receiverWalletAddress: entity.receiverWalletAddress,
          receiverWalletAddressId: entity.receiverWalletAddressId,
          destination: entity.destination,
          assetCode: entity.assetCode,
          assetScale: entity.assetScale,
          metadata: entity.metadata
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
          ...getErrorDetails(err)
        },
        cmd.requestId
      );

      return event;
    }
  }

  private handleCompletePaymentIntentCommand(cmd: CompletePaymentIntentCmd) {
    this._logger.debug(
      `handleCompletePaymentIntentCommand — paymentIntentId: ${cmd.payload.id}`
    );
    const { id: paymentIntentId } = cmd.payload;

    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);
      paymentIntent.complete();
      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this.completedPaymentIntentIds.push(paymentIntent.id);

      return new PaymentIntentCompletedEvent(
        this._toCompletedPayload(paymentIntent),
        cmd.requestId
      );
    } catch (err) {
      return new PaymentIntentCompleteFailedEvent(
        {
          id: cmd.payload.id,
          ...getErrorDetails(err)
        },
        cmd.requestId
      );
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
        remotePaymentIntentUrl: remoteUrl,
        createdAt
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
        const exchangeRate = this._getIntraAseRate(
          walletAddress.assetCode,
          paymentIntent.assetCode
        );

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
          exchangeRate,
          createdAt: createdAt ? new Date(createdAt) : undefined
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
            createdAt: completedQuote.createdAt.toISOString(),
            debitAmount: String(completedQuote.debitAmount),
            receiveAmount: String(completedQuote.receiveAmount),
            exchangeRate: completedQuote.exchangeRate
          },
          cmd.requestId
        );
      }

      // REMOTE: resolve peer, create pending quote, emit event to initiate quoting
      const { destinationIlpAddress } = paymentIntent;
      if (!destinationIlpAddress) {
        throw new MissingDestinationIlpAddressError(
          `Payment intent ${paymentIntentId} is missing destinationIlpAddress`
        );
      }

      const peerFetchError = this.peerFetchErrors.get(destinationIlpAddress);
      if (peerFetchError) throw peerFetchError;

      const peer = this.peerMap.get(destinationIlpAddress);
      if (!peer) {
        throw new PeerNotFoundError(
          `No peer found for ILP address ${destinationIlpAddress}`
        );
      }

      // probe amount: 1 unit of peer asset (e.g. scale 2 -> 100 = 1.00)
      const sourceAmount = 10n ** BigInt(peer.assetScale);

      paymentIntent.addPendingRemoteQuote({
        id: quoteId,
        senderWalletAddress: {
          id: senderWalletAddressId,
          address: senderWalletAddress,
          assetCode: walletAddress.assetCode,
          assetScale: walletAddress.assetScale
        },
        peerId: peer.peerId,
        peerAssetCode: peer.assetCode,
        peerAssetScale: peer.assetScale,
        sourceAmount,
        debitAmount: debitAmount ? BigInt(debitAmount) : undefined,
        receiveAmount: receiveAmount ? BigInt(receiveAmount) : undefined,
        createdAt: createdAt ? new Date(createdAt) : undefined
      });

      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this._appendToMap(this.newPaymentIntentQuotes, paymentIntent.id, quoteId);

      this._logger.debug(
        `handleCreateQuoteCommand — REMOTE quote pending quoteId: ${quoteId} destinationIlpAddress: ${destinationIlpAddress} peerId: ${peer.peerId}`
      );
      return new RemoteQuoteRequestedEvent(
        {
          paymentIntentId: paymentIntent.id,
          quoteId,
          requestId: cmd.requestId,
          senderWalletAddress,
          receiverWalletAddress: paymentIntent.receiverWalletAddress,
          senderAssetCode: walletAddress.assetCode,
          senderAssetScale: walletAddress.assetScale,
          receiverAssetCode: paymentIntent.assetCode,
          receiverAssetScale: paymentIntent.assetScale,
          peerId: peer.peerId,
          peerAssetCode: peer.assetCode,
          peerAssetScale: peer.assetScale,
          sourceAmount: sourceAmount.toString(),
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
          ...getErrorDetails(err)
        },
        cmd.requestId
      );
    }
  }

  /**
   * Creates a payment against a payment intent.
   *
   * With `quoteId`, amounts come from the completed quote.
   * Without quote:
   * - Local intents fall back to `debitAmount`, then to the intent's
   *   `incomingAmount`. The receive amount comes from the intra-ASE rate.
   * - Remote intents are fixed-send: `debitAmount` is required. The receive
   *    amount is unknown without a quote and stays `null`, and the peer is
   *    resolved here from the intent's destination ILP address (whereas the
   *    quote path binds it during quoting instead).
   */
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
      debitAmount,
      createdAt,
      remotePaymentIntentUrl: remoteUrl,
      grantId,
      metadata
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

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);

      let payment: ISentPayment;
      if (paymentIntent.destination === 'LOCAL') {
        const exchangeRate = this._getIntraAseRate(
          walletAddress.assetCode,
          paymentIntent.assetCode
        );

        payment = paymentIntent.addLocalPayment({
          id: paymentId,
          senderWalletAddress: {
            id: senderWalletAddressId,
            address: senderWalletAddress,
            assetScale: walletAddress.assetScale,
            assetCode: walletAddress.assetCode
          },
          exchangeRate,
          quoteId,
          debitAmount: debitAmount ? BigInt(debitAmount) : undefined,
          createdAt: createdAt ? new Date(createdAt) : undefined,
          grantId,
          metadata: metadata ? JSON.parse(metadata) : undefined
        });
      } else if (quoteId) {
        payment = paymentIntent.addRemotePaymentFromQuote({
          id: paymentId,
          quoteId,
          senderWalletAddress: {
            id: senderWalletAddressId,
            address: senderWalletAddress,
            assetScale: walletAddress.assetScale,
            assetCode: walletAddress.assetCode
          },
          createdAt: createdAt ? new Date(createdAt) : undefined,
          grantId,
          metadata: metadata ? JSON.parse(metadata) : undefined
        });
      } else {
        // Quoteless remote payment is fixed-send only. The intent was imported
        // via remoteUrl and the the peer is resolved here since we dont have
        // it from the quoting step. receiveAmount is unkonwn (null).
        if (!debitAmount) {
          throw new InvalidPaymentAmountError(
            `Remote payment ${paymentId} without a quoteId requires a debitAmount`
          );
        }

        const { destinationIlpAddress } = paymentIntent;
        if (!destinationIlpAddress) {
          throw new MissingDestinationIlpAddressError(
            `Payment intent ${paymentIntent.id} is missing destinationIlpAddress`
          );
        }

        const peerFetchError = this.peerFetchErrors.get(destinationIlpAddress);
        if (peerFetchError) throw peerFetchError;

        const peer = this.peerMap.get(destinationIlpAddress);
        if (!peer) {
          throw new PeerNotFoundError(
            `No peer found for ILP address ${destinationIlpAddress}`
          );
        }

        payment = paymentIntent.addRemotePayment({
          id: paymentId,
          senderWalletAddress: {
            id: senderWalletAddressId,
            address: senderWalletAddress,
            assetScale: walletAddress.assetScale,
            assetCode: walletAddress.assetCode
          },
          debitAmount: BigInt(debitAmount),
          peerId: peer.peerId,
          createdAt: createdAt ? new Date(createdAt) : undefined,
          grantId,
          metadata: metadata ? JSON.parse(metadata) : undefined
        });
      }

      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this._appendToMap(this.newSentPaymentsMap, paymentIntent.id, paymentId);

      this._logger.debug(
        `handleCreatePaymentCommand — created paymentId: ${paymentId}`
      );

      return new PaymentCreatedEvent(
        {
          id: payment.id,
          paymentIntentId: payment.paymentIntentId,
          quoteId: payment.quoteId,
          senderWalletAddressId: payment.senderWalletAddressId,
          senderWalletAddress: payment.senderWalletAddress,
          debitAmount: String(payment.debitAmount),
          receiveAmount:
            payment.receiveAmount === null
              ? null
              : String(payment.receiveAmount),
          sentAmount: String(payment.sentAmount),
          state: payment.state,
          createdAt: payment.createdAt,
          expiresAt: payment.expiresAt,
          assetCode: payment.assetCode,
          assetScale: payment.assetScale,
          receiveAssetCode: paymentIntent.assetCode,
          receiveAssetScale: paymentIntent.assetScale,
          metadata: payment.metadata,
          paymentIntentRemoteUrl: paymentIntent.remoteUrl
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
          grantId: cmd.payload.grantId,
          ...getErrorDetails(err)
        },
        cmd.requestId
      );

      return event;
    }
  }

  private async handleCompleteRemoteQuoteCommand(cmd: CompleteRemoteQuoteCmd) {
    this._logger.debug(
      `handleCompleteRemoteQuoteCommand — quoteId: ${cmd.payload.quoteId} paymentIntentId: ${cmd.payload.paymentIntentId}`
    );
    const { quoteId, paymentIntentId, receiveAmountValue } = cmd.payload;

    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);

      const pendingQuoteObj = paymentIntent.quotes.find(
        (q) => q.id === quoteId
      );
      if (!pendingQuoteObj || pendingQuoteObj.state !== 'PENDING') {
        throw new InvalidQuoteIdError(
          `Pending quote ${quoteId} not found for payment intent ${paymentIntentId}`
        );
      }
      const { route, debitAmount: requestedDebit } = pendingQuoteObj;

      if (!route) {
        this._logger.warn(
          `handleCompleteRemoteQuoteCommand — pending quote ${quoteId} (paymentIntent ${paymentIntentId}) has no route`
        );
        throw new InvalidQuoteStateError(
          `Pending quote ${quoteId} has no route; it cannot be completed as remote`
        );
      }
      const { peerId, peerAssetCode, senderAssetCode } = route;

      let fxRate: number | undefined;
      if (senderAssetCode !== peerAssetCode) {
        const direction: 'source' | 'destination' = requestedDebit
          ? 'source'
          : 'destination';
        const key = fxKey(peerId, direction, senderAssetCode);
        const fxFetchError = this.fxRateFetchErrors.get(key);
        if (fxFetchError) throw fxFetchError;

        const rate = this.fxRateMap.get(key) ?? null;
        if (rate == null) {
          throw new RatesError(
            `Could not get FX rate from PAL for peer ${peerId} ${direction} asset ${senderAssetCode}`
          );
        }
        fxRate = rate;
      }

      const completedQuote = paymentIntent.completeRemoteQuote({
        id: quoteId,
        receiveAmountValue: BigInt(receiveAmountValue),
        fxRate
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
          createdAt: completedQuote.createdAt.toISOString(),
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
          ...getErrorDetails(err)
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
    const errorType = cmd.payload.errorType ?? 'Internal';

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
        { paymentIntentId, errorName, errorType, message },
        cmd.requestId
      );
    } catch (err) {
      return new QuoteCreateFailedEvent(
        {
          paymentIntentId,
          ...getErrorDetails(err)
        },
        cmd.requestId
      );
    }
  }

  private handleCalculateRemoteQuoteCommand(cmd: CalculateRemoteQuoteCmd) {
    this._logger.debug(
      `handleCalculateRemoteQuoteCommand — paymentIntentId: ${cmd.payload.paymentIntentId} packetId: ${cmd.payload.packetId}`
    );
    const { packetId, peerId, paymentIntentId } = cmd.payload;

    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);

      // Peer asset was prefetched from PAL by peerId (not carried on the command).
      const peerFetchError = this.peerByIdFetchErrors.get(peerId);
      if (peerFetchError) throw peerFetchError;
      const peer = this.peersById.get(peerId);
      if (!peer) {
        throw new PeerNotFoundError(`No peer found for peer id ${peerId}`);
      }
      const { assetCode: peerAssetCode, assetScale: peerAssetScale } = peer;

      let fxRate: number | undefined;
      if (peerAssetCode !== paymentIntent.assetCode) {
        const key = fxKey(peerId, 'source', peerAssetCode);
        const fxFetchError = this.fxRateFetchErrors.get(key);
        if (fxFetchError) throw fxFetchError;

        const rate = this.fxRateMap.get(key) ?? null;
        if (rate == null) {
          throw new RatesError(
            `Could not get FX rate from PAL for peer ${peerId} source asset ${peerAssetCode}`
          );
        }
        fxRate = rate;
      }

      const sourceAmount = BigInt(cmd.payload.sourceAmount);
      const receiveAmount = paymentIntent.convertPeerAmount({
        sourceAmount,
        peerAssetCode,
        peerAssetScale,
        fxRate
      });

      return new RemoteQuoteCalculatedEvent(
        {
          packetId,
          peerId,
          paymentIntentId,
          receiveAmount: String(receiveAmount),
          receiveAssetCode: paymentIntent.assetCode,
          receiveAssetScale: paymentIntent.assetScale
        },
        cmd.requestId
      );
    } catch (err) {
      this._logger.debug(
        `handleCalculateRemoteQuoteCommand — failed paymentIntentId: ${paymentIntentId} error: ${(err as Error).message}`
      );
      return new RemoteQuoteCalculationFailedEvent(
        {
          packetId,
          peerId,
          paymentIntentId,
          ...getErrorDetails(err)
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
    let errorContext: PaymentCompleteFailedAdditionalData = {};

    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);

      if (paymentIntent.destination === 'LOCAL') {
        const payment = paymentIntent.completeLocalPayment({ id: paymentId });
        errorContext = {
          sentAmount: payment.sentAmount.toString(),
          walletAddressId: payment.senderWalletAddressId,
          assetCode: payment.assetCode,
          assetScale: payment.assetScale
        };
        this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
        this._appendToMap(
          this.completedLocalPayments,
          paymentIntent.id,
          paymentId
        );

        const events: IMessage[] = [
          new PaymentCompletedEvent(
            {
              id: payment.id,
              paymentIntentId: payment.paymentIntentId,
              senderWalletAddressId: payment.senderWalletAddressId,
              senderWalletAddress: payment.senderWalletAddress,
              debitAmount: String(payment.debitAmount),
              receiveAmount:
                payment.receiveAmount === null
                  ? null
                  : String(payment.receiveAmount),
              sentAmount: String(payment.sentAmount),
              state: payment.state,
              createdAt: payment.createdAt,
              assetCode: payment.assetCode,
              assetScale: payment.assetScale,
              receiveAssetCode: paymentIntent.assetCode,
              receiveAssetScale: paymentIntent.assetScale,
              grantId: payment.grantId,
              metadata: payment.metadata
            },
            cmd.requestId
          )
        ];
        if (paymentIntent.state === 'COMPLETED') {
          events.push(
            new PaymentIntentCompletedEvent(
              this._toCompletedPayload(paymentIntent),
              cmd.requestId
            )
          );
        }
        return events;
      }

      // REMOTE: transition to PROCESSING and emit approval event for PAL.
      if (!paymentIntent.destinationIlpAddress) {
        throw new MissingDestinationIlpAddressError(
          `Payment intent ${paymentIntentId} is missing destinationIlpAddress`
        );
      }

      const payment = paymentIntent.approveRemotePaymentSend({
        id: paymentId
      });
      errorContext = {
        sentAmount: payment.sentAmount.toString(),
        walletAddressId: payment.senderWalletAddressId,
        assetCode: payment.assetCode,
        assetScale: payment.assetScale
      };
      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this._appendToMap(
        this.approvedRemotePayments,
        paymentIntent.id,
        paymentId
      );

      return new RemotePaymentSendApprovedEvent(
        {
          paymentIntentId: paymentIntent.id,
          paymentId: payment.id,
          state: payment.state,
          senderWalletAddress: payment.senderWalletAddress,
          senderWalletAddressId: payment.senderWalletAddressId,
          destinationIlpAddress: paymentIntent.destinationIlpAddress,
          peerId: payment.peerId,
          requestId: cmd.requestId,
          debitAmount: String(payment.debitAmount),
          assetCode: payment.assetCode,
          assetScale: payment.assetScale
        },
        cmd.requestId
      );
    } catch (err) {
      return new PaymentCompleteFailedEvent(
        {
          id: cmd.payload.id,
          paymentIntentId: cmd.payload.paymentIntentId,
          grantId: this._grantIdForPayment(
            cmd.payload.paymentIntentId,
            cmd.payload.id
          ),
          ...errorContext,
          ...getErrorDetails(err)
        },
        cmd.requestId
      );
    }
  }

  private async handlePrepareRemotePaymentCommand(
    cmd: PrepareRemotePaymentCmd
  ) {
    this._logger.debug(
      `handlePrepareRemotePaymentCommand — paymentId: ${cmd.payload.paymentId} paymentIntentId: ${cmd.payload.paymentIntentId}`
    );
    const { paymentIntentId, paymentId, ledgerTransferId } = cmd.payload;
    let errorContext: PaymentCompleteFailedAdditionalData = {};

    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);

      if (!paymentIntent.destinationIlpAddress) {
        throw new MissingDestinationIlpAddressError(
          `Payment intent ${paymentIntentId} is missing destinationIlpAddress`
        );
      }

      if (!paymentIntent.remoteUrl) {
        throw new Error(
          `Payment intent ${paymentIntentId} is missing remoteUrl; cannot fetch sharedSecret`
        );
      }

      // Fresh sharedSecret per prepare — the OP server regenerates on each
      // fetch, and we deliberately don't persist it on the intent nor prefetch
      // to ensure its not stale.
      const remoteDetails =
        await this._remotePaymentIntentService.fetchPaymentIntent(
          paymentIntent.remoteUrl
        );

      const payment = paymentIntent.prepareRemotePayment({
        id: paymentId,
        ledgerTransferId
      });
      errorContext = {
        sentAmount: payment.sentAmount.toString(),
        walletAddressId: payment.senderWalletAddressId,
        assetCode: payment.assetCode,
        assetScale: payment.assetScale
      };
      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this._appendToMap(
        this.sendingRemotePayments,
        paymentIntent.id,
        paymentId
      );

      return new RemotePaymentPreparedEvent(
        {
          paymentIntentId: paymentIntent.id,
          paymentId: payment.id,
          ledgerTransferId,
          destinationIlpAddress: remoteDetails.destinationIlpAddress,
          peerId: payment.peerId,
          requestId: cmd.requestId,
          debitAmount: String(payment.debitAmount),
          receiveAmount:
            payment.receiveAmount === null
              ? null
              : String(payment.receiveAmount),
          assetCode: payment.assetCode,
          assetScale: payment.assetScale,
          sharedSecret: remoteDetails.sharedSecret,
          // TODO: packet expiry — picked 30s to match the ILP quote handler.
          expiresAt: new Date(Date.now() + 30_000).toISOString()
        },
        cmd.requestId
      );
    } catch (err) {
      return new PaymentCompleteFailedEvent(
        {
          id: cmd.payload.paymentId,
          paymentIntentId,
          grantId: this._grantIdForPayment(
            paymentIntentId,
            cmd.payload.paymentId
          ),
          ...errorContext,
          ...getErrorDetails(err)
        },
        cmd.requestId
      );
    }
  }

  private handleFailRemotePaymentCommand(cmd: FailRemotePaymentCmd) {
    this._logger.debug(
      `handleFailRemotePaymentCommand — paymentId: ${cmd.payload.paymentId} paymentIntentId: ${cmd.payload.paymentIntentId} reason: ${cmd.payload.reason}`
    );
    const { paymentIntentId, paymentId, reason } = cmd.payload;
    let errorContext: PaymentCompleteFailedAdditionalData = {};

    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);
      const payment = paymentIntent.failRemotePayment({
        id: paymentId,
        reason
      });
      errorContext = {
        sentAmount: payment.sentAmount.toString(),
        walletAddressId: payment.senderWalletAddressId,
        assetCode: payment.assetCode,
        assetScale: payment.assetScale
      };
      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this._appendToMap(this.failedRemotePayments, paymentIntent.id, paymentId);

      return new PaymentFailedEvent(
        {
          id: payment.id,
          paymentIntentId: payment.paymentIntentId,
          senderWalletAddress: payment.senderWalletAddress,
          debitAmount: String(payment.debitAmount),
          receiveAmount:
            payment.receiveAmount === null
              ? null
              : String(payment.receiveAmount),
          sentAmount: String(payment.sentAmount),
          state: payment.state,
          createdAt: payment.createdAt,
          assetCode: payment.assetCode,
          assetScale: payment.assetScale,
          receiveAssetCode: paymentIntent.assetCode,
          receiveAssetScale: paymentIntent.assetScale,
          reason,
          grantId: payment.grantId
        },
        cmd.requestId
      );
    } catch (err) {
      return new PaymentCompleteFailedEvent(
        {
          id: cmd.payload.paymentId,
          paymentIntentId,
          grantId: this._grantIdForPayment(
            paymentIntentId,
            cmd.payload.paymentId
          ),
          ...errorContext,
          ...getErrorDetails(err)
        },
        cmd.requestId
      );
    }
  }

  private handleConfirmRemotePaymentCommand(cmd: ConfirmRemotePaymentCmd) {
    this._logger.debug(
      `handleConfirmRemotePaymentCommand — paymentId: ${cmd.payload.paymentId} paymentIntentId: ${cmd.payload.paymentIntentId}`
    );
    const { paymentIntentId, paymentId } = cmd.payload;
    let errorContext: PaymentCompleteFailedAdditionalData = {};

    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);
      const existingPayment = paymentIntent.remoteSentPayments.find(
        (p) => p.id === paymentId
      );
      if (!existingPayment) {
        throw new PaymentNotFoundError(
          `Payment ${paymentId} not found for ${paymentIntentId} payment intent`
        );
      }
      errorContext = {
        sentAmount: existingPayment.sentAmount.toString(),
        walletAddressId: existingPayment.senderWalletAddressId,
        assetCode: existingPayment.assetCode,
        assetScale: existingPayment.assetScale
      };
      if (!existingPayment.ledgerTransferId) {
        throw new Error(
          `Payment ${paymentId} is missing ledgerTransferId at confirm time`
        );
      }
      if (!paymentIntent.destinationIlpAddress) {
        throw new MissingDestinationIlpAddressError(
          `Payment intent ${paymentIntentId} is missing destinationIlpAddress`
        );
      }

      const payment = paymentIntent.confirmRemotePayment({ id: paymentId });
      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this._appendToMap(
        this.confirmedRemotePayments,
        paymentIntent.id,
        paymentId
      );

      return new RemotePaymentSendConfirmedEvent(
        {
          paymentIntentId: paymentIntent.id,
          paymentId: payment.id,
          ledgerTransferId: existingPayment.ledgerTransferId,
          destinationIlpAddress: paymentIntent.destinationIlpAddress,
          peerId: payment.peerId,
          requestId: cmd.requestId,
          debitAmount: String(payment.debitAmount),
          assetCode: payment.assetCode,
          assetScale: payment.assetScale
        },
        cmd.requestId
      );
    } catch (err) {
      return new PaymentCompleteFailedEvent(
        {
          id: cmd.payload.paymentId,
          paymentIntentId,
          grantId: this._grantIdForPayment(
            paymentIntentId,
            cmd.payload.paymentId
          ),
          ...errorContext,
          ...getErrorDetails(err)
        },
        cmd.requestId
      );
    }
  }

  private handleRejectRemotePaymentCommand(cmd: RejectRemotePaymentCmd) {
    this._logger.debug(
      `handleRejectRemotePaymentCommand — paymentId: ${cmd.payload.paymentId} paymentIntentId: ${cmd.payload.paymentIntentId} reason: ${cmd.payload.reason} rejectCode: ${cmd.payload.rejectCode}`
    );
    const { paymentIntentId, paymentId, reason, rejectCode, rejectMessage } =
      cmd.payload;
    let errorContext: PaymentCompleteFailedAdditionalData = {};

    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);
      const existingPayment = paymentIntent.remoteSentPayments.find(
        (p) => p.id === paymentId
      );
      if (!existingPayment) {
        throw new PaymentNotFoundError(
          `Payment ${paymentId} not found for ${paymentIntentId} payment intent`
        );
      }
      errorContext = {
        sentAmount: existingPayment.sentAmount.toString(),
        walletAddressId: existingPayment.senderWalletAddressId,
        assetCode: existingPayment.assetCode,
        assetScale: existingPayment.assetScale
      };
      if (!existingPayment.ledgerTransferId) {
        throw new Error(
          `Payment ${paymentId} is missing ledgerTransferId at reject time`
        );
      }
      if (!paymentIntent.destinationIlpAddress) {
        throw new MissingDestinationIlpAddressError(
          `Payment intent ${paymentIntentId} is missing destinationIlpAddress`
        );
      }

      const payment = paymentIntent.rejectRemotePayment({
        id: paymentId,
        reason
      });
      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this._appendToMap(
        this.rejectedRemotePayments,
        paymentIntent.id,
        paymentId
      );

      return new RemotePaymentSendRejectedEvent(
        {
          paymentIntentId: paymentIntent.id,
          paymentId: payment.id,
          ledgerTransferId: existingPayment.ledgerTransferId,
          reason,
          rejectCode,
          rejectMessage,
          destinationIlpAddress: paymentIntent.destinationIlpAddress,
          peerId: payment.peerId,
          requestId: cmd.requestId,
          debitAmount: String(payment.debitAmount),
          assetCode: payment.assetCode,
          assetScale: payment.assetScale
        },
        cmd.requestId
      );
    } catch (err) {
      return new PaymentCompleteFailedEvent(
        {
          id: cmd.payload.paymentId,
          paymentIntentId,
          grantId: this._grantIdForPayment(
            paymentIntentId,
            cmd.payload.paymentId
          ),
          ...errorContext,
          ...getErrorDetails(err)
        },
        cmd.requestId
      );
    }
  }

  private handleCompleteRemotePaymentCommand(cmd: CompleteRemotePaymentCmd) {
    this._logger.debug(
      `handleCompleteRemotePaymentCommand — paymentId: ${cmd.payload.paymentId} paymentIntentId: ${cmd.payload.paymentIntentId}`
    );
    const { paymentIntentId, paymentId } = cmd.payload;
    let errorContext: PaymentCompleteFailedAdditionalData = {};

    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);
      const payment = paymentIntent.completeRemotePayment({ id: paymentId });
      errorContext = {
        sentAmount: payment.sentAmount.toString(),
        walletAddressId: payment.senderWalletAddressId,
        assetCode: payment.assetCode,
        assetScale: payment.assetScale
      };
      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this._appendToMap(
        this.completedRemotePayments,
        paymentIntent.id,
        paymentId
      );

      const events: IMessage[] = [
        new PaymentCompletedEvent(
          {
            id: payment.id,
            paymentIntentId: payment.paymentIntentId,
            senderWalletAddressId: payment.senderWalletAddressId,
            senderWalletAddress: payment.senderWalletAddress,
            debitAmount: String(payment.debitAmount),
            receiveAmount:
              payment.receiveAmount === null
                ? null
                : String(payment.receiveAmount),
            sentAmount: String(payment.sentAmount),
            state: payment.state,
            createdAt: payment.createdAt,
            assetCode: payment.assetCode,
            assetScale: payment.assetScale,
            receiveAssetCode: paymentIntent.assetCode,
            receiveAssetScale: paymentIntent.assetScale,
            grantId: payment.grantId,
            metadata: payment.metadata
          },
          cmd.requestId
        )
      ];
      if (paymentIntent.state === 'COMPLETED') {
        events.push(
          new PaymentIntentCompletedEvent(
            this._toCompletedPayload(paymentIntent),
            cmd.requestId
          )
        );
      }
      return events;
    } catch (err) {
      return new PaymentCompleteFailedEvent(
        {
          id: cmd.payload.paymentId,
          paymentIntentId,
          grantId: this._grantIdForPayment(
            paymentIntentId,
            cmd.payload.paymentId
          ),
          ...errorContext,
          ...getErrorDetails(err)
        },
        cmd.requestId
      );
    }
  }

  private handleValidateInboundPaymentCommand(cmd: ValidateInboundPaymentCmd) {
    this._logger.debug(
      `handleValidateInboundPaymentCommand — inboundPaymentId: ${cmd.payload.id} paymentIntentId: ${cmd.payload.paymentIntentId} packetId: ${cmd.payload.packetId}`
    );
    const {
      id: inboundPaymentId,
      paymentIntentId,
      packetId,
      peerId
    } = cmd.payload;

    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);

      // Peer asset is resolved from PAL by peerId (prefetched into peersById),
      // not carried on the inbound ILP event.
      const peerByIdError = this.peerByIdFetchErrors.get(peerId);
      if (peerByIdError) throw peerByIdError;
      const peer = this.peersById.get(peerId);
      if (!peer) {
        throw new PeerNotFoundError(`No peer found for peer id ${peerId}`);
      }
      const { assetCode: peerAssetCode, assetScale: peerAssetScale } = peer;

      let fxRate: number | undefined;
      if (peerAssetCode !== paymentIntent.assetCode) {
        const key = fxKey(peerId, 'source', peerAssetCode);
        const fxFetchError = this.fxRateFetchErrors.get(key);
        if (fxFetchError) throw fxFetchError;

        const rate = this.fxRateMap.get(key) ?? null;
        if (rate == null) {
          throw new RatesError(
            `Could not get FX rate from PAL for peer ${peerId} source asset ${peerAssetCode}`
          );
        }
        fxRate = rate;
      }

      const inboundPayment = paymentIntent.addInboundPayment({
        id: inboundPaymentId,
        packetId,
        peerId,
        peerAssetCode,
        peerAssetScale,
        sourceAmount: BigInt(cmd.payload.sourceAmount),
        fxRate,
        expiresAt: cmd.payload.expiresAt
          ? new Date(cmd.payload.expiresAt)
          : undefined
      });

      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this._appendToMap(
        this.newInboundPayments,
        paymentIntent.id,
        inboundPaymentId
      );

      return new InboundPaymentValidatedEvent(
        {
          paymentIntentId: paymentIntent.id,
          inboundPaymentId: inboundPayment.id,
          packetId,
          peerId,
          requestId: cmd.requestId,
          sourceAmount: String(inboundPayment.sourceAmount),
          peerAssetCode,
          peerAssetScale,
          receiveAmount: String(inboundPayment.receiveAmount),
          receiveAssetCode: paymentIntent.assetCode,
          receiveAssetScale: paymentIntent.assetScale,
          receiverWalletAddressId: paymentIntent.receiverWalletAddressId,
          state: inboundPayment.state,
          createdAt: inboundPayment.createdAt
        },
        cmd.requestId
      );
    } catch (err) {
      this._logger.debug(
        `handleValidateInboundPaymentCommand — failed paymentIntentId: ${paymentIntentId} error: ${(err as Error).message}`
      );
      return new InboundPaymentValidationFailedEvent(
        {
          paymentIntentId,
          inboundPaymentId,
          packetId,
          peerId,
          ...getErrorDetails(err)
        },
        cmd.requestId
      );
    }
  }

  private handleAcceptInboundPaymentCommand(cmd: AcceptInboundPaymentCmd) {
    this._logger.debug(
      `handleAcceptInboundPaymentCommand — inboundPaymentId: ${cmd.payload.inboundPaymentId} paymentIntentId: ${cmd.payload.paymentIntentId}`
    );
    const { inboundPaymentId, paymentIntentId, ledgerTransferId } = cmd.payload;

    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);
      const inboundPayment = paymentIntent.acceptInboundPayment({
        id: inboundPaymentId,
        ledgerTransferId
      });

      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this._appendToMap(
        this.acceptedInboundPayments,
        paymentIntent.id,
        inboundPaymentId
      );

      return new InboundPaymentAcceptedEvent(
        {
          paymentIntentId: paymentIntent.id,
          inboundPaymentId: inboundPayment.id,
          packetId: inboundPayment.packetId,
          peerId: inboundPayment.peerId,
          requestId: cmd.requestId,
          ledgerTransferId,
          receiveAmount: String(inboundPayment.receiveAmount),
          receiveAssetCode: paymentIntent.assetCode,
          receiveAssetScale: paymentIntent.assetScale,
          state: inboundPayment.state
        },
        cmd.requestId
      );
    } catch (err) {
      this._logger.debug(
        `handleAcceptInboundPaymentCommand — failed paymentIntentId: ${paymentIntentId} error: ${(err as Error).message}`
      );
      return new InboundPaymentFailedEvent(
        {
          paymentIntentId,
          inboundPaymentId,
          ...getErrorDetails(err)
        },
        cmd.requestId
      );
    }
  }

  private handleFailInboundPaymentCommand(cmd: FailInboundPaymentCmd) {
    this._logger.debug(
      `handleFailInboundPaymentCommand — inboundPaymentId: ${cmd.payload.inboundPaymentId} paymentIntentId: ${cmd.payload.paymentIntentId} reason: ${cmd.payload.reason}`
    );
    const { inboundPaymentId, paymentIntentId, reason } = cmd.payload;

    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);
      const inboundPayment = paymentIntent.failInboundPayment({
        id: inboundPaymentId,
        reason
      });

      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this._appendToMap(
        this.failedInboundPayments,
        paymentIntent.id,
        inboundPaymentId
      );

      return new InboundPaymentFailedEvent(
        {
          paymentIntentId: paymentIntent.id,
          inboundPaymentId: inboundPayment.id,
          packetId: inboundPayment.packetId,
          peerId: inboundPayment.peerId,
          errorName: 'InboundPaymentFailed',
          errorType: 'Internal',
          message: reason ?? 'Inbound payment failed'
        },
        cmd.requestId
      );
    } catch (err) {
      this._logger.debug(
        `handleFailInboundPaymentCommand — failed paymentIntentId: ${paymentIntentId} error: ${(err as Error).message}`
      );
      return new InboundPaymentFailedEvent(
        {
          paymentIntentId,
          inboundPaymentId,
          ...getErrorDetails(err)
        },
        cmd.requestId
      );
    }
  }

  private handleMarkInboundPaymentFulfillableCommand(
    cmd: MarkInboundPaymentFulfillableCmd
  ) {
    this._logger.debug(
      `handleMarkInboundPaymentFulfillableCommand — inboundPaymentId: ${cmd.payload.inboundPaymentId} paymentIntentId: ${cmd.payload.paymentIntentId}`
    );
    const { inboundPaymentId, paymentIntentId } = cmd.payload;

    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);
      const inboundPayment = paymentIntent.markInboundPaymentFulfillable({
        id: inboundPaymentId
      });

      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this._appendToMap(
        this.fulfillableInboundPayments,
        paymentIntent.id,
        inboundPaymentId
      );

      return new InboundPaymentFulfillableEvent(
        {
          paymentIntentId: paymentIntent.id,
          inboundPaymentId: inboundPayment.id,
          packetId: inboundPayment.packetId,
          peerId: inboundPayment.peerId,
          requestId: cmd.requestId,
          receiveAmount: String(inboundPayment.receiveAmount),
          receiveAssetCode: paymentIntent.assetCode,
          receiveAssetScale: paymentIntent.assetScale,
          state: inboundPayment.state
        },
        cmd.requestId
      );
    } catch (err) {
      this._logger.debug(
        `handleMarkInboundPaymentFulfillableCommand — failed paymentIntentId: ${paymentIntentId} error: ${(err as Error).message}`
      );
      return new InboundPaymentFailedEvent(
        {
          paymentIntentId,
          inboundPaymentId,
          ...getErrorDetails(err)
        },
        cmd.requestId
      );
    }
  }

  private handleFinalizeInboundPaymentCommand(cmd: FinalizeInboundPaymentCmd) {
    this._logger.debug(
      `handleFinalizeInboundPaymentCommand — inboundPaymentId: ${cmd.payload.inboundPaymentId} paymentIntentId: ${cmd.payload.paymentIntentId}`
    );
    const { inboundPaymentId, paymentIntentId } = cmd.payload;

    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);
      const inboundPayment = paymentIntent.finalizeInboundPayment({
        id: inboundPaymentId
      });

      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this._appendToMap(
        this.finalizedInboundPayments,
        paymentIntent.id,
        inboundPaymentId
      );

      const events: IMessage[] = [
        new InboundPaymentFinalizedEvent(
          {
            paymentIntentId: paymentIntent.id,
            inboundPaymentId: inboundPayment.id,
            packetId: inboundPayment.packetId,
            peerId: inboundPayment.peerId,
            sourceAmount: String(inboundPayment.sourceAmount),
            receiveAmount: String(inboundPayment.receiveAmount),
            receiveAssetCode: paymentIntent.assetCode,
            receiveAssetScale: paymentIntent.assetScale,
            state: inboundPayment.state
          },
          cmd.requestId
        )
      ];
      if (paymentIntent.state === 'COMPLETED') {
        events.push(
          new PaymentIntentCompletedEvent(
            this._toCompletedPayload(paymentIntent),
            cmd.requestId
          )
        );
      }
      return events;
    } catch (err) {
      this._logger.debug(
        `handleFinalizeInboundPaymentCommand — failed paymentIntentId: ${paymentIntentId} error: ${(err as Error).message}`
      );
      return new InboundPaymentFailedEvent(
        {
          paymentIntentId,
          inboundPaymentId,
          ...getErrorDetails(err)
        },
        cmd.requestId
      );
    }
  }

  private async handleCancelPaymentCommand(cmd: CancelPaymentCmd) {
    this._logger.debug(
      `handleCancelPaymentCommand — paymentId: ${cmd.payload.id} paymentIntentId: ${cmd.payload.paymentIntentId}`
    );
    const { id: paymentId, paymentIntentId, reason } = cmd.payload;

    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);
      paymentIntent.cancelPayment({ id: paymentId, reason });
      const payment = paymentIntent.sentPayments.find(
        (p) => p.id === paymentId
      );
      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      this._appendToMap(this.cancelledPayments, paymentIntent.id, paymentId);

      return new PaymentCancelledEvent(
        { id: paymentId, grantId: payment?.grantId },
        cmd.requestId
      );
    } catch (err) {
      return new PaymentCancelFailedEvent(
        {
          paymentIntentId: cmd.payload.paymentIntentId,
          grantId: this._grantIdForPayment(
            cmd.payload.paymentIntentId,
            cmd.payload.id
          ),
          ...getErrorDetails(err)
        },
        cmd.requestId
      );
    }
  }

  private handleExpirePaymentIntentCommand(cmd: ExpirePaymentIntentCmd) {
    this._logger.debug(
      `handleExpirePaymentIntentCommand — paymentIntentId: ${cmd.payload.paymentIntentId}`
    );
    const { paymentIntentId } = cmd.payload;
    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);
      paymentIntent.expire();
      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      return new PaymentIntentExpiredEvent(
        {
          paymentIntentId: paymentIntent.id,
          state: paymentIntent.state
        },
        cmd.requestId
      );
    } catch (err) {
      return new PaymentIntentExpireFailedEvent({
        paymentIntentId: cmd.payload.paymentIntentId,
        ...getErrorDetails(err)
      });
    }
  }

  private handleExpirePaymentCommand(cmd: ExpirePaymentCmd) {
    this._logger.debug(
      `handleExpirePaymentCommand — paymentId: ${cmd.payload.paymentId} paymentIntentId: ${cmd.payload.paymentIntentId}`
    );
    const { paymentId, paymentIntentId } = cmd.payload;
    try {
      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }
      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);
      const payment = paymentIntent.expirePayment(paymentId);
      this.paymentIntentMap.set(paymentIntent.id, paymentIntent.toObject());
      return new PaymentExpiredEvent(
        {
          paymentId: payment.id,
          paymentIntentId: paymentIntentId
        },
        cmd.requestId
      );
    } catch (err) {
      return new PaymentExpireFailedEvent({
        paymentId: cmd.payload.paymentId,
        ...getErrorDetails(err)
      });
    }
  }

  private _grantIdForPayment(
    paymentIntentId: string,
    paymentId: string
  ): string | undefined {
    return this.paymentIntentMap
      .get(paymentIntentId)
      ?.sentPayments.find((payment) => payment.id === paymentId)?.grantId;
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
            await this._remotePaymentIntentService.fetchPaymentIntent(url);
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

  private _toCompletedPayload(
    paymentIntent: PaymentIntent
  ): PaymentIntentCompletedPayload {
    return {
      id: paymentIntent.id,
      createdAt: paymentIntent.createdAt,
      expiresAt: paymentIntent.expiresAt,
      receivedAmount: String(paymentIntent.receivedAmount),
      incomingAmount:
        paymentIntent.incomingAmount != null
          ? String(paymentIntent.incomingAmount)
          : null,
      state: paymentIntent.state,
      receiverWalletAddress: paymentIntent.receiverWalletAddress,
      receiverWalletAddressId: paymentIntent.receiverWalletAddressId,
      destination: paymentIntent.destination,
      destinationIlpAddress: paymentIntent.destinationIlpAddress,
      assetCode: paymentIntent.assetCode,
      assetScale: paymentIntent.assetScale,
      metadata: paymentIntent.metadata
    };
  }

  private _collectIlpAddress(
    cmd: CreateQuoteCmd | CreatePaymentCmd,
    into: Set<string>
  ): void {
    const { paymentIntentId } = cmd.payload;
    if (this.remotePaymentIntentFetchErrors.has(paymentIntentId)) return;
    const intent = this.paymentIntentMap.get(paymentIntentId);
    if (!intent) return;
    if (intent.destination !== PaymentIntentDestination.REMOTE) return;
    if (!intent.destinationIlpAddress) return;
    into.add(intent.destinationIlpAddress);
  }

  private _collectFxLookup(
    cmd: CompleteRemoteQuoteCmd,
    into: Map<string, IFxRateRequest>
  ): void {
    const { paymentIntentId, quoteId } = cmd.payload;
    const intent = this.paymentIntentMap.get(paymentIntentId);
    if (!intent) return;
    const quote = intent.quotes.find((q) => q.id === quoteId);
    if (!quote || quote.state !== 'PENDING') return;
    if (!quote.route) return;
    const { peerId, peerAssetCode, senderAssetCode } = quote.route;
    if (senderAssetCode === peerAssetCode) return;
    const direction: 'source' | 'destination' = quote.debitAmount
      ? 'source'
      : 'destination';
    const key = fxKey(peerId, direction, senderAssetCode);
    if (!into.has(key)) {
      into.set(
        key,
        direction === 'source'
          ? { peerId, sourceAssetCode: senderAssetCode }
          : { peerId, destinationAssetCode: senderAssetCode }
      );
    }
  }

  private _collectInboundFxLookup(
    payload: { paymentIntentId: string; peerId: string },
    peerAssetCode: string | undefined,
    into: Map<string, IFxRateRequest>
  ): void {
    const { paymentIntentId, peerId } = payload;
    // peer not resolved (missing/errored PAL lookup) — the command handler
    // will fail the quote; nothing to prefetch here.
    if (!peerAssetCode) return;
    const intent = this.paymentIntentMap.get(paymentIntentId);
    if (!intent) return;
    if (peerAssetCode === intent.assetCode) return;
    const key = fxKey(peerId, 'source', peerAssetCode);
    if (!into.has(key)) {
      into.set(key, { peerId, sourceAssetCode: peerAssetCode });
    }
  }

  private _collectIntraAseFxLookup(
    paymentIntentId: string,
    senderWalletAddressId: string,
    into: Map<string, IFxRateRequest>
  ): void {
    const walletAddress = this.walletAddressMap.get(senderWalletAddressId);
    if (!walletAddress) return;
    const intent = this.paymentIntentMap.get(paymentIntentId);
    if (!intent) return;
    if (intent.destination !== PaymentIntentDestination.LOCAL) return;
    const sourceAssetCode = walletAddress.assetCode;
    const destinationAssetCode = intent.assetCode;
    if (sourceAssetCode === destinationAssetCode) return;
    const key = intraFxKey(sourceAssetCode, destinationAssetCode);
    if (!into.has(key)) {
      into.set(key, { sourceAssetCode, destinationAssetCode });
    }
  }

  private _getIntraAseRate(
    sourceAssetCode: string,
    destinationAssetCode: string
  ): number {
    if (sourceAssetCode === destinationAssetCode) return 1;
    const key = intraFxKey(sourceAssetCode, destinationAssetCode);
    const fxFetchError = this.fxRateFetchErrors.get(key);
    if (fxFetchError) throw fxFetchError;
    const rate = this.fxRateMap.get(key) ?? null;
    if (rate == null) {
      throw new RatesError('Could not get rates during quoting');
    }
    return rate;
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

  /**
   * The payments named by `ids`, projected for storage. One pass, with a set
   * for the id lookup — flush does this for every update group.
   */
  private _collectPayments<T>(
    payments: ISentPayment[],
    ids: string[],
    project: (payment: ISentPayment) => T
  ): T[] {
    const wanted = new Set(ids);
    const collected: T[] = [];
    for (const payment of payments) {
      if (wanted.has(payment.id)) {
        collected.push(project(payment));
      }
    }
    return collected;
  }

  /** As `_collectPayments`, for groups whose columns only remote payments have. */
  private _collectRemotePayments<T>(
    payments: ISentPayment[],
    ids: string[],
    project: (payment: IRemoteSentPayment) => T
  ): T[] {
    const wanted = new Set(ids);
    const collected: T[] = [];
    for (const payment of payments) {
      if (wanted.has(payment.id) && isRemoteSentPayment(payment)) {
        collected.push(project(payment));
      }
    }
    return collected;
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

    if (this.completedPaymentIntentIds.length > 0) {
      const completedEntities: { id: string; state: PaymentIntentState }[] = [];
      for (const id of this.completedPaymentIntentIds) {
        const paymentIntent = this.paymentIntentMap.get(id);
        if (!paymentIntent) {
          this._logger.error(
            `Payment intent ${id} missing from paymentIntentMap during flush (completed payment intents)`
          );
          continue;
        }

        completedEntities.push({
          id: paymentIntent.id,
          state: paymentIntent.state
        });
      }

      promises.push(this._repo.storeCompletedPaymentIntents(completedEntities));
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

    if (this.newSentPaymentsMap.size > 0) {
      const updates: {
        paymentIntent: IPaymentIntent;
        paymentIds: string[];
      }[] = [];
      for (const [
        paymentIntentId,
        paymentIds
      ] of this.newSentPaymentsMap.entries()) {
        const paymentIntent = this.paymentIntentMap.get(paymentIntentId);
        if (!paymentIntent) {
          this._logger.error(
            `Payment intent ${paymentIntentId} missing from paymentIntentMap during flush (payments)`
          );
          continue;
        }

        updates.push({ paymentIntent, paymentIds });
      }

      promises.push(this._repo.storeSentPayments(updates));
    }

    if (this.newInboundPayments.size > 0) {
      const updates: {
        paymentIntent: IPaymentIntent;
        inboundPaymentIds: string[];
      }[] = [];
      for (const [
        paymentIntentId,
        inboundPaymentIds
      ] of this.newInboundPayments.entries()) {
        const paymentIntent = this.paymentIntentMap.get(paymentIntentId);
        if (!paymentIntent) {
          this._logger.error(
            `Payment intent ${paymentIntentId} missing from paymentIntentMap during flush (inbound payments)`
          );
          continue;
        }

        updates.push({ paymentIntent, inboundPaymentIds });
      }

      promises.push(this._repo.storeInboundPayments(updates));
    }

    if (this.acceptedInboundPayments.size > 0) {
      const updates: {
        inboundPayments: {
          id: string;
          state: InboundPaymentState;
          ledgerTransferId: string;
        }[];
      }[] = [];

      for (const [
        paymentIntentId,
        inboundPaymentIds
      ] of this.acceptedInboundPayments.entries()) {
        const paymentIntent = this.paymentIntentMap.get(paymentIntentId);
        if (!paymentIntent) {
          this._logger.error(
            `Payment intent ${paymentIntentId} missing from paymentIntentMap during flush (accepted inbound payments)`
          );
          continue;
        }

        updates.push({
          inboundPayments: paymentIntent.inboundPayments
            .filter((rp) => inboundPaymentIds.includes(rp.id))
            .map((rp) => ({
              id: rp.id,
              state: rp.state,
              ledgerTransferId: rp.ledgerTransferId ?? ''
            }))
        });
      }

      promises.push(this._repo.storeAcceptedInboundPayments(updates));
    }

    if (this.failedInboundPayments.size > 0) {
      const updates: {
        inboundPayments: {
          id: string;
          state: InboundPaymentState;
          failReason?: string;
        }[];
      }[] = [];

      for (const [
        paymentIntentId,
        inboundPaymentIds
      ] of this.failedInboundPayments.entries()) {
        const paymentIntent = this.paymentIntentMap.get(paymentIntentId);
        if (!paymentIntent) {
          this._logger.error(
            `Payment intent ${paymentIntentId} missing from paymentIntentMap during flush (failed inbound payments)`
          );
          continue;
        }

        updates.push({
          inboundPayments: paymentIntent.inboundPayments
            .filter((rp) => inboundPaymentIds.includes(rp.id))
            .map((rp) => ({
              id: rp.id,
              state: rp.state,
              failReason: rp.failReason
            }))
        });
      }

      promises.push(this._repo.storeFailedInboundPayments(updates));
    }

    if (this.fulfillableInboundPayments.size > 0) {
      const updates: {
        inboundPayments: { id: string; state: InboundPaymentState }[];
      }[] = [];

      for (const [
        paymentIntentId,
        inboundPaymentIds
      ] of this.fulfillableInboundPayments.entries()) {
        const paymentIntent = this.paymentIntentMap.get(paymentIntentId);
        if (!paymentIntent) {
          this._logger.error(
            `Payment intent ${paymentIntentId} missing from paymentIntentMap during flush (fulfillable inbound payments)`
          );
          continue;
        }

        updates.push({
          inboundPayments: paymentIntent.inboundPayments
            .filter((rp) => inboundPaymentIds.includes(rp.id))
            .map((rp) => ({ id: rp.id, state: rp.state }))
        });
      }

      promises.push(this._repo.storeFulfillableInboundPayments(updates));
    }

    if (this.finalizedInboundPayments.size > 0) {
      const updates: {
        paymentIntent: {
          id: string;
          receivedAmount: bigint;
          state: PaymentIntentState;
        };
        inboundPayments: { id: string; state: InboundPaymentState }[];
      }[] = [];

      for (const [
        paymentIntentId,
        inboundPaymentIds
      ] of this.finalizedInboundPayments.entries()) {
        const paymentIntent = this.paymentIntentMap.get(paymentIntentId);
        if (!paymentIntent) {
          this._logger.error(
            `Payment intent ${paymentIntentId} missing from paymentIntentMap during flush (finalized inbound payments)`
          );
          continue;
        }

        updates.push({
          paymentIntent: {
            id: paymentIntent.id,
            state: paymentIntent.state,
            receivedAmount: paymentIntent.receivedAmount
          },
          inboundPayments: paymentIntent.inboundPayments
            .filter((rp) => inboundPaymentIds.includes(rp.id))
            .map((rp) => ({ id: rp.id, state: rp.state }))
        });
      }

      promises.push(this._repo.storeFinalizedInboundPayments(updates));
    }

    if (this.completedLocalPayments.size > 0) {
      const updates: {
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
          sentPayments: this._collectPayments(
            paymentIntent.sentPayments,
            paymentIds,
            (p) => ({ id: p.id, state: p.state, sentAmount: p.sentAmount })
          )
        });
      }

      promises.push(this._repo.storeCompletedLocalPayments(updates));
    }

    if (this.completedRemotePayments.size > 0) {
      const updates: {
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
      }[] = [];

      for (const [
        paymentIntentId,
        paymentIds
      ] of this.completedRemotePayments.entries()) {
        const paymentIntent = this.paymentIntentMap.get(paymentIntentId);
        if (!paymentIntent) {
          this._logger.error(
            `Payment intent ${paymentIntentId} missing from paymentIntentMap during flush (completed remote payments)`
          );
          continue;
        }

        updates.push({
          paymentIntent: {
            id: paymentIntent.id,
            state: paymentIntent.state,
            receivedAmount: paymentIntent.receivedAmount
          },
          sentPayments: this._collectPayments(
            paymentIntent.sentPayments,
            paymentIds,
            (p) => ({ id: p.id, state: p.state, sentAmount: p.sentAmount })
          )
        });
      }

      promises.push(this._repo.storeCompletedRemotePayments(updates));
    }

    if (this.approvedRemotePayments.size > 0) {
      const updates: {
        sentPayments: { id: string; state: SentPaymentState }[];
      }[] = [];

      for (const [
        paymentIntentId,
        paymentIds
      ] of this.approvedRemotePayments.entries()) {
        const paymentIntent = this.paymentIntentMap.get(paymentIntentId);
        if (!paymentIntent) {
          this._logger.error(
            `Payment intent ${paymentIntentId} missing from paymentIntentMap during flush (approved remote payments)`
          );
          continue;
        }

        updates.push({
          sentPayments: this._collectPayments(
            paymentIntent.sentPayments,
            paymentIds,
            (p) => ({ id: p.id, state: p.state })
          )
        });
      }

      promises.push(this._repo.storeApprovedRemotePayments(updates));
    }

    if (this.sendingRemotePayments.size > 0) {
      const updates: {
        sentPayments: {
          id: string;
          state: SentPaymentState;
          ledgerTransferId: string;
        }[];
      }[] = [];

      for (const [
        paymentIntentId,
        paymentIds
      ] of this.sendingRemotePayments.entries()) {
        const paymentIntent = this.paymentIntentMap.get(paymentIntentId);
        if (!paymentIntent) {
          this._logger.error(
            `Payment intent ${paymentIntentId} missing from paymentIntentMap during flush (sending remote payments)`
          );
          continue;
        }

        updates.push({
          sentPayments: this._collectRemotePayments(
            paymentIntent.sentPayments,
            paymentIds,
            (p) => ({
              id: p.id,
              state: p.state,
              ledgerTransferId: p.ledgerTransferId ?? ''
            })
          )
        });
      }

      promises.push(this._repo.storeSendingRemotePayments(updates));
    }

    if (this.confirmedRemotePayments.size > 0) {
      const updates: {
        sentPayments: { id: string; state: SentPaymentState }[];
      }[] = [];

      for (const [
        paymentIntentId,
        paymentIds
      ] of this.confirmedRemotePayments.entries()) {
        const paymentIntent = this.paymentIntentMap.get(paymentIntentId);
        if (!paymentIntent) {
          this._logger.error(
            `Payment intent ${paymentIntentId} missing from paymentIntentMap during flush (confirmed remote payments)`
          );
          continue;
        }

        updates.push({
          sentPayments: this._collectPayments(
            paymentIntent.sentPayments,
            paymentIds,
            (p) => ({ id: p.id, state: p.state })
          )
        });
      }

      promises.push(this._repo.storeConfirmedRemotePayments(updates));
    }

    if (this.rejectedRemotePayments.size > 0) {
      const updates: {
        sentPayments: {
          id: string;
          state: SentPaymentState;
          failReason?: string;
        }[];
      }[] = [];

      for (const [
        paymentIntentId,
        paymentIds
      ] of this.rejectedRemotePayments.entries()) {
        const paymentIntent = this.paymentIntentMap.get(paymentIntentId);
        if (!paymentIntent) {
          this._logger.error(
            `Payment intent ${paymentIntentId} missing from paymentIntentMap during flush (rejected remote payments)`
          );
          continue;
        }

        updates.push({
          sentPayments: this._collectRemotePayments(
            paymentIntent.sentPayments,
            paymentIds,
            (p) => ({ id: p.id, state: p.state, failReason: p.failReason })
          )
        });
      }

      promises.push(this._repo.storeRejectedRemotePayments(updates));
    }

    if (this.failedRemotePayments.size > 0) {
      const updates: {
        sentPayments: {
          id: string;
          state: SentPaymentState;
          failReason?: string;
        }[];
      }[] = [];

      for (const [
        paymentIntentId,
        paymentIds
      ] of this.failedRemotePayments.entries()) {
        const paymentIntent = this.paymentIntentMap.get(paymentIntentId);
        if (!paymentIntent) {
          this._logger.error(
            `Payment intent ${paymentIntentId} missing from paymentIntentMap during flush (failed remote payments)`
          );
          continue;
        }

        updates.push({
          sentPayments: this._collectRemotePayments(
            paymentIntent.sentPayments,
            paymentIds,
            (p) => ({ id: p.id, state: p.state, failReason: p.failReason })
          )
        });
      }

      promises.push(this._repo.storeFailedRemotePayments(updates));
    }

    if (this.cancelledPayments.size > 0) {
      const updates: {
        sentPayments: {
          id: string;
          state: SentPaymentState;
          cancelledAt: Date;
          cancelReason?: string;
        }[];
      }[] = [];

      for (const [
        paymentIntentId,
        paymentIds
      ] of this.cancelledPayments.entries()) {
        const paymentIntent = this.paymentIntentMap.get(paymentIntentId);
        if (!paymentIntent) {
          this._logger.error(
            `Payment intent ${paymentIntentId} missing from paymentIntentMap during flush (payments)`
          );
          continue;
        }

        updates.push({
          sentPayments: this._collectPayments(
            paymentIntent.sentPayments,
            paymentIds,
            (p) => ({
              id: p.id,
              state: p.state,
              cancelledAt: p.cancelledAt ?? new Date(),
              cancelReason: p.cancelReason
            })
          )
        });
      }

      promises.push(this._repo.storeCancelledPayments(updates));
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
      this.newSentPaymentsMap.clear();
      this.newInboundPayments.clear();
      this.acceptedInboundPayments.clear();
      this.failedInboundPayments.clear();
      this.fulfillableInboundPayments.clear();
      this.finalizedInboundPayments.clear();
      this.completedLocalPayments.clear();
      this.approvedRemotePayments.clear();
      this.sendingRemotePayments.clear();
      this.confirmedRemotePayments.clear();
      this.rejectedRemotePayments.clear();
      this.completedRemotePayments.clear();
      this.failedRemotePayments.clear();
      this.cancelledPayments.clear();
      this.finalizedRemoteQuotes.clear();
      this.newPaymentIntentQuotes.clear();
      this.newPaymentIntentIds = [];
      this.completedPaymentIntentIds = [];
      this.remotePaymentIntentFetchErrors.clear();
      this.peerMap.clear();
      this.peerFetchErrors.clear();
      this.peersById.clear();
      this.peerByIdFetchErrors.clear();
      this.fxRateMap.clear();
      this.fxRateFetchErrors.clear();
    }
  }
}
