import { Message } from 'common-types-lib';
import {
  IPaymentIntent,
  IPaymentIntentRepository,
  IWalletAddressAdapter,
  PaymentIntentDestination,
  WalletAddress
} from './interfaces';
import { PaymentIntent } from './entity';
import { CreatePaymentIntentCmd } from '../commands';
import {
  CannotCreateDuplicatePaymentIntentError,
  WalletAddressNotFoundError,
  WalletAddressInactiveError
} from './errors';
import {
  PaymentIntentCreatedEvent,
  PaymentIntentCreateFailedEvent
} from './events';

export class PaymentIntentAggregate {
  constructor(
    private _repo: IPaymentIntentRepository,
    private _walletAddressService: IWalletAddressAdapter
  ) {}

  async handleBatch(
    cmds: Message[]
  ): Promise<{ events: Message[]; updatedEntities: IPaymentIntent[] }> {
    const outputEvents: Message[] = [];
    const updatedEntities: IPaymentIntent[] = [];

    // prefetch any external data needed to process the batch
    const walletIdSet = new Set<string>();
    const paymentIntentIdsSet = new Set<string>();
    for (const cmd of cmds) {
      if (cmd.msgName === CreatePaymentIntentCmd.name) {
        const payload = (cmd as CreatePaymentIntentCmd).payload;
        walletIdSet.add(payload.receiverWalletAddressId);
        paymentIntentIdsSet.add(payload.id);
      }
    }

    const [walletAddresses, existingPayments] = await Promise.all([
      this._walletAddressService.fetchByIds([...walletIdSet]),
      this._repo.fetchByIds([...paymentIntentIdsSet])
    ]);

    const walletAddressMap = new Map<string, WalletAddress>();
    for (const walletAddress of walletAddresses) {
      walletAddressMap.set(walletAddress.id, walletAddress);
    }

    // seed seenIds with existing DB entities — add newly processed ones as we go
    const seenIds = new Set<string>(existingPayments.map((p) => p.id));

    // process each command
    for (const cmd of cmds) {
      if (cmd.msgName === CreatePaymentIntentCmd.name) {
        const command = cmd as CreatePaymentIntentCmd;
        try {
          const { entity, event } = this.create(
            command.payload,
            walletAddressMap,
            seenIds,
            command.requestId
          );

          updatedEntities.push(entity);
          seenIds.add(command.payload.id);
          outputEvents.push(event);
        } catch (e) {
          outputEvents.push(
            new PaymentIntentCreateFailedEvent(
              {
                errorName: (e as Error).constructor.name,
                message: (e as Error).message
              },
              command.requestId
            )
          );
        }
      }
    }

    return { events: outputEvents, updatedEntities };
  }

  private create(
    payload: CreatePaymentIntentCmd['payload'],
    walletAddressMap: Map<string, WalletAddress>,
    seenIds: Set<string>,
    requestId?: string
  ): {
    entity: IPaymentIntent;
    event: PaymentIntentCreatedEvent;
  } {
    const {
      id,
      receiverWalletAddressId,
      receiverWalletAddress,
      expiresAt,
      incomingAmount
    } = payload;

    if (seenIds.has(id)) {
      throw new CannotCreateDuplicatePaymentIntentError(
        `Payment intent with id ${id} already exists`
      );
    }

    const walletAddress = walletAddressMap.get(receiverWalletAddressId);
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

    // TODO: Validate asset match if incomingAmount provided?
    // Currently incomingAmount on the command is currently a bare number.
    // Keep and use wallet address asset? Or require as means of confirming
    // the sender understands the asset to be used?
    // - v1 Rafiki requires it to be passed in

    const entity = new PaymentIntent(
      id,
      receiverWalletAddressId,
      receiverWalletAddress,
      PaymentIntentDestination.LOCAL, // TODO: determine from peer lookup
      walletAddress.assetCode,
      walletAddress.assetScale,
      expiresAt ?? null,
      incomingAmount != null ? BigInt(incomingAmount) : null
    ).toObject();

    const event = new PaymentIntentCreatedEvent({ id }, requestId);

    return { entity, event };
  }

  public async flush(entities: IPaymentIntent[]) {
    if (entities.length > 0) {
      await this._repo.storeMany(entities);
    }
  }
}
