import { IMessage } from 'common-types-lib';
import {
  IPaymentIntent,
  IPaymentIntentRepository,
  IRatesService,
  IWalletAddressService,
  PaymentIntentDestination,
  PaymentIntentState,
  PaymentState,
  WalletAddress
} from './interfaces';
import { PaymentIntent } from './entity';
import {
  CreatePaymentIntentCmd,
  CreateQuoteCmd,
  CreatePaymentCmd,
  ApprovePaymentCmd
} from '../commands';
import {
  CannotCreateDuplicatePaymentIntentError,
  WalletAddressNotFoundError,
  WalletAddressInactiveError,
  PaymentIntentNotFoundError,
  PaymentIntentInvalidState,
  RatesError
} from './errors';
import {
  QuoteCompletedEvent,
  QuoteCreateFailedEvent,
  PaymentIntentCreatedEvent,
  PaymentIntentCreateFailedEvent,
  PaymentCreateFailedEvent,
  LocalPaymentCompletedEvent,
  LocalPaymentCompleteFailedEvent,
  PaymentCreatedEvent
} from './events';

export class PaymentIntentAggregate {
  private newPaymentIntentIds: string[] = [];
  private newPaymentIntentQuotes = new Map<string, string[]>(); // paymentIntentId, quoteIds
  private newPaymentsMap = new Map<string, string[]>(); // paymentIntentId, paymentIds
  private completedLocalPayments = new Map<string, string[]>(); // paymentIntentId, paymentIds
  private paymentIntentMap = new Map<string, IPaymentIntent>();
  private walletAddressMap = new Map<string, WalletAddress>();

  constructor(
    private _repo: IPaymentIntentRepository,
    private _walletAddressService: IWalletAddressService,
    private _ratesService: IRatesService
  ) {}

  async handleBatch(cmds: IMessage[]): Promise<{ events: IMessage[] }> {
    const outputEvents: IMessage[] = [];

    // prefetch any external data needed to process the batch
    const walletAddressIdSet = new Set<string>();
    const paymentIntentIdsSet = new Set<string>();
    for (const cmd of cmds) {
      if (cmd.msgName === CreatePaymentIntentCmd.name) {
        const payload = (cmd as CreatePaymentIntentCmd).payload;
        walletAddressIdSet.add(payload.receiverWalletAddressId);
        paymentIntentIdsSet.add(payload.id);
      } else if (cmd.msgName === CreateQuoteCmd.name) {
        const payload = (cmd as CreateQuoteCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
        walletAddressIdSet.add(payload.senderWalletAddressId);
      } else if (cmd.msgName === CreatePaymentCmd.name) {
        const payload = (cmd as CreatePaymentCmd).payload;
        walletAddressIdSet.add(payload.senderWalletAddressId);
        paymentIntentIdsSet.add(payload.paymentIntentId);
      } else if (cmd.msgName === ApprovePaymentCmd.name) {
        const payload = (cmd as ApprovePaymentCmd).payload;
        paymentIntentIdsSet.add(payload.paymentIntentId);
      }
    }

    const [walletAddresses, existingPaymentIntents] = await Promise.all([
      this._walletAddressService.fetchByIds([...walletAddressIdSet]),
      this._repo.fetchByIdsWithPayments([...paymentIntentIdsSet])
    ]);

    for (const walletAddress of walletAddresses) {
      this.walletAddressMap.set(walletAddress.id, walletAddress);
    }

    for (const paymentIntent of existingPaymentIntents) {
      this.paymentIntentMap.set(paymentIntent.id, paymentIntent);
    }

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
      } else {
        throw new Error('Unexpected command');
      }

      outputEvents.push(event);
    }

    return { events: outputEvents };
  }

  private handleCreatePaymentIntentCommand(cmd: CreatePaymentIntentCmd) {
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
      // Currently incomingAmount on the command is currently a bare number.
      // Keep and use wallet address asset? Or require as means of confirming
      // the sender understands the asset to be used?
      // - v1 Rafiki requires it to be passed in

      const entity = PaymentIntent.create(
        id,
        receiverWalletAddressId,
        receiverWalletAddress,
        PaymentIntentDestination.LOCAL, // TODO: determine from peer lookup
        walletAddress.assetCode,
        walletAddress.assetScale,
        expiresAt ?? null,
        incomingAmount != null ? BigInt(incomingAmount) : null
      );

      this.paymentIntentMap.set(id, entity.toObject());
      this.newPaymentIntentIds.push(id);

      const event = new PaymentIntentCreatedEvent({ id }, cmd.requestId);

      return event;
    } catch (err) {
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
    try {
      const {
        id: quoteId,
        senderWalletAddressId,
        senderWalletAddress,
        receiveAmount,
        debitAmount,
        paymentIntentId
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

      const paymentIntentObj = this.paymentIntentMap.get(paymentIntentId);
      if (!paymentIntentObj) {
        throw new PaymentIntentNotFoundError(
          `Payment intent ${paymentIntentId} not found`
        );
      }

      // NOTE: Do we check here if the receiving wallet address is deactivated?
      // Or is payment intent deactivation something that we could handle on a "wallet deactivated" event,
      // where we just mark all of the payment intents as EXPIRED/COMPLETED?

      const paymentIntent = PaymentIntent.fromObject(paymentIntentObj);

      const exchangeRate = await this._ratesService.getRate(
        walletAddress.assetCode,
        paymentIntent.assetCode
      );

      if (!exchangeRate) {
        throw new RatesError('Could not get rates during quoting');
      }

      // TODO: handle ILP quotes
      if (paymentIntent.destination !== 'LOCAL') {
        throw new PaymentIntentInvalidState(
          'Payment intent destination must be local'
        );
      }

      paymentIntent.addLocalQuote({
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
      this.appendToMap(this.newPaymentIntentQuotes, paymentIntent.id, quoteId);

      const quoteCompletedEvent = new QuoteCompletedEvent(
        { id: quoteId },
        cmd.requestId
      );
      return quoteCompletedEvent;
    } catch (err) {
      const event = new QuoteCreateFailedEvent(
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

  private async handleCreatePaymentCommand(cmd: CreatePaymentCmd) {
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

      paymentIntent.addLocalPayment({
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
      this.appendToMap(this.newPaymentsMap, paymentIntent.id, paymentId);

      return new PaymentCreatedEvent({ id: paymentId }, cmd.requestId);
    } catch (err) {
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

  private async handleApprovePaymentCommand(cmd: ApprovePaymentCmd) {
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
      this.appendToMap(
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

  private appendToMap(
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
          console.error(
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
          console.error(
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
          console.error(
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
          console.error(
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

    // TODO handle gracefully
    try {
      await Promise.all(promises);
    } finally {
      this.paymentIntentMap.clear();
      this.walletAddressMap.clear(); // TODO: wallet addresses are OK to be cached
      this.newPaymentsMap.clear();
      this.completedLocalPayments.clear();
      this.newPaymentIntentQuotes.clear();
      this.newPaymentIntentIds = [];
    }
  }
}
