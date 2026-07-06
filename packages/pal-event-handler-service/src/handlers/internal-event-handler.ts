import {
  ILogger,
  IMessageProducer,
  IMessageConsumer,
  IMessage,
  DomainEventTopics,
  DomainEvent,
  MessageTypes
} from 'common-types-lib';
import {
  AssetCreatedEvent,
  LedgerAccountCreatedForAssetEvent,
  LedgerAccountsCreatedForPeerEvent,
  PeerCreatedEvent,
  PeerFxCacheExpiredEvent
} from 'pal-public-types-lib';
import {
  AssetAggregate,
  CreateLedgerAccountForAssetCmd,
  CreateLedgerAccountsForPeerCmd,
  CreateLedgerCmd,
  PeerAggregate
} from 'pal-domain-lib';

/**
 * Internal event handler for processing internal PAL bounded context events
 */
export class InternalEventHandler {
  private readonly _logger: ILogger;
  private readonly _msgConsumer: IMessageConsumer;
  private readonly _msgProducer: IMessageProducer;
  private readonly _pendingMessages: IMessage[] = [];
  private readonly _assetAggregate: AssetAggregate;
  private readonly _peerAggregate: PeerAggregate;

  constructor(
    peerAggregate: PeerAggregate,
    assetAggregate: AssetAggregate,
    messageConsumer: IMessageConsumer,
    msgProducer: IMessageProducer,
    logger: ILogger
  ) {
    this._logger = logger;
    this._peerAggregate = peerAggregate;
    this._assetAggregate = assetAggregate;
    this._msgConsumer = messageConsumer;
    this._msgProducer = msgProducer;
  }

  private async _handleMessageBatch(messages: IMessage[]) {
    this._logger.info(`Received batch of ${messages.length} messages`);
    // NOTE: we shouldn't log ignored events, they can be the majority

    for (const msg of messages) {
      if (msg.msgType !== MessageTypes.DOMAIN_EVENT) {
        continue;
      }

      await this._handleEvent(msg as DomainEvent);
    }

    if (this._pendingMessages.length > 0) {
      await this._msgProducer.send(this._pendingMessages);
      this._logger.debug(
        `Published ${this._pendingMessages.length} pending messages at the end of the batch`
      );
      this._pendingMessages.length = 0;
    }
  }

  private async _handleEvent(evt: DomainEvent): Promise<void> {
    if (evt.msgName === PeerCreatedEvent.name) {
      await this._handlePeerCreatedEvent(evt as PeerCreatedEvent);
    } else if (evt.msgName === LedgerAccountsCreatedForPeerEvent.name) {
      await this._handleLedgerAccountsCreatedForPeerEvent(
        evt as LedgerAccountsCreatedForPeerEvent
      );
    } else if (evt.msgName === AssetCreatedEvent.name) {
      await this._handleAssetCreatedEvent(evt as AssetCreatedEvent);
    } else if (evt.msgName === LedgerAccountCreatedForAssetEvent.name) {
      await this._handleLedgerAccountCreatedForAssetEvent(
        evt as LedgerAccountCreatedForAssetEvent
      );
    } else if (evt.msgName === PeerFxCacheExpiredEvent.name) {
      await this._handlePeerFxCacheExpiredEvent(evt as PeerFxCacheExpiredEvent);
    } else {
      this._logger.debug(
        `Internal event handler - unhandled event type: ${evt.msgName}`
      );
    }
  }

  // region peer events saga
  private async _handlePeerCreatedEvent(evt: PeerCreatedEvent): Promise<void> {
    // let's request the ledger accounts to be created for the new peer
    const cmd = new CreateLedgerAccountsForPeerCmd(evt.payload.assetCode, {
      peerId: evt.payload.peerId,
      assetCode: evt.payload.assetCode,
      peerLiquidityAccId: crypto.randomUUID(),
      peerClearingAccId: crypto.randomUUID(),
      aseLiquidityAccId: crypto.randomUUID(),
      aseClearingAccId: crypto.randomUUID(),
      suspenseAccId: crypto.randomUUID()
    });
    if (evt.requestId) {
      cmd.requestId = evt.requestId;
    }
    this._pendingMessages.push(cmd);
    this._logger.debug(
      `_handlePeerCreatedEvent: peerId: ${evt.payload.peerId} - requestId: ${evt.requestId}`
    );
  }

  private async _handleLedgerAccountsCreatedForPeerEvent(
    evt: LedgerAccountsCreatedForPeerEvent
  ): Promise<void> {
    // let's associate the ledger accounts with the peer and activate the peer
    await this._peerAggregate.associateLedgerAccountsAndActivate(
      evt.payload.peerId,
      evt.payload.peerLiquidityAccId,
      evt.payload.peerClearingAccId,
      evt.payload.aseLiquidityAccId,
      evt.payload.aseClearingAccId,
      evt.payload.suspenseAccId
    );

    if (this._peerAggregate.uncommittedDomainEvents.length == 0) {
      this._logger.warn(
        'No uncommitted domain events after peer associateLedgerAccountsAndActivate called'
      );
      return;
    }

    // propagate source request id the outgoing events (PeerActivatedEvent)
    this._peerAggregate.uncommittedDomainEvents.every((outEvt) => {
      outEvt.requestId = evt.requestId;
      this._pendingMessages.push(outEvt);
    });
    this._logger.debug(
      `_handleLedgerAccountsCreatedForPeerEvent: peerId: ${evt.payload.peerId} - requestId: ${evt.requestId}`
    );
  }
  // endregion peer events saga

  // region asset events saga
  private async _handleAssetCreatedEvent(
    evt: AssetCreatedEvent
  ): Promise<void> {
    // request the ledger to create the system account for the asset
    const cmd1 = new CreateLedgerCmd({ id: evt.payload.assetCode });

    const cmd2 = new CreateLedgerAccountForAssetCmd(evt.payload.assetCode, {
      id: crypto.randomUUID(),
      assetCode: evt.payload.assetCode
    });

    // propagate the source requestid and push the pending cmd msg
    [cmd1, cmd2].forEach((cmd) => {
      if (evt.requestId) {
        cmd.requestId = evt.requestId;
      }
      this._pendingMessages.push(cmd);
    });
    this._logger.debug(
      `_handleAssetCreatedEvent: ${evt.payload.assetCode} - requestId: ${evt.requestId}`
    );
  }

  private async _handleLedgerAccountCreatedForAssetEvent(
    evt: LedgerAccountCreatedForAssetEvent
  ): Promise<void> {
    await this._assetAggregate.associateLedgerAccountAndActivate(
      evt.payload.assetCode,
      evt.payload.id
    );

    if (this._assetAggregate.uncommittedDomainEvents.length == 0) {
      this._logger.warn(
        'No uncommitted domain events after asset associateLedgerAccountAndActivate called'
      );
      return;
    }

    // propagate source request id the outgoing events (PeerActivatedEvent)
    this._assetAggregate.uncommittedDomainEvents.every((outEvt) => {
      outEvt.requestId = evt.requestId;
      this._pendingMessages.push(outEvt);
    });
    this._logger.debug(
      `_handleLedgerAccountCreatedForAssetEvent: ${evt.payload.assetCode} - ledger accountId: ${evt.payload.id} - requestId: ${evt.requestId}`
    );
  }

  // endregion asset events saga

  // peer fx cache pre-fetch of expires rates
  private async _handlePeerFxCacheExpiredEvent(
    event: PeerFxCacheExpiredEvent
  ): Promise<void> {
    this._logger.debug(
      `_handlePeerFxCacheExpiredEvent: ${event.payload.peerId}`
    );

    await this._peerAggregate.notifyExpiredFxRate(
      event.payload.peerId,
      event.payload.sourceAssetCode,
      event.payload.destinationAssetCode
    );
  }

  async init(): Promise<void> {
    this._msgConsumer.setTopics([
      DomainEventTopics.PeerEvents,
      DomainEventTopics.AssetEvents,
      DomainEventTopics.LedgerEvents
    ]);
    this._msgConsumer.setBatchCallbackFn(this._handleMessageBatch.bind(this));
    await this._msgConsumer.connect();
    await this._msgConsumer.startAndWaitForRebalance();

    this._logger.info(`${this.constructor.name} initialized`);
  }

  async destroy(): Promise<void> {
    await this._msgConsumer.stop();
    return;
  }
}
