import {
  ConsoleLogger,
  ILogger,
  IMessage,
  IMessageProducer,
  MessageTypes
} from 'common-types-lib';
import {
  DispatchFulfillPacketCmd,
  DispatchPreparePacketCmd,
  DispatchRejectPacketCmd,
  ProcessFulfillPacketCmd,
  ProcessPreparePacketCmd,
  ProcessRejectPacketCmd
} from 'ilp-domain-lib';
import { ITransportCorrelationStore } from './correlation/store';
import { IConnectorTransport, WirePrepare, WireResponse } from './transport';

export class IlpConnector {
  constructor(
    private readonly _producer: IMessageProducer,
    private readonly _transport: IConnectorTransport,
    private readonly _correlationStore: ITransportCorrelationStore,
    private readonly _logger: ILogger = new ConsoleLogger(),
    private readonly _ilpAddress?: string
  ) {}

  init(): void {
    this._transport.onResponse((response) =>
      this._handleWireResponse(response)
    );
    this._transport.onInboundPrepare((prepare) =>
      this._handleInboundPrepare(prepare)
    );
    this._transport.onOutboundPrepareAccepted?.((prepare) =>
      this._onOutboundPrepareAccepted(prepare)
    );
  }

  async handleConnectorCommands(messages: IMessage[]): Promise<void> {
    const unhandled: string[] = [];
    const dispatches: Promise<void>[] = [];

    for (const msg of messages) {
      if (msg.msgType !== MessageTypes.COMMAND) continue;

      switch (msg.msgName) {
        case DispatchPreparePacketCmd.name:
          dispatches.push(
            this._handleDispatchPrepare(
              (msg as DispatchPreparePacketCmd).payload
            )
          );
          break;
        case DispatchFulfillPacketCmd.name: {
          const payload = (msg as DispatchFulfillPacketCmd).payload;
          dispatches.push(
            this._transport.sendFulfill(
              {
                kind: 'FULFILL',
                packetId: payload.packetId,
                fulfillment: payload.fulfillment,
                data: payload.data
              },
              payload.peerId,
              payload.callbackDeadline
            )
          );
          break;
        }
        case DispatchRejectPacketCmd.name: {
          const payload = (msg as DispatchRejectPacketCmd).payload;
          dispatches.push(
            this._transport.sendReject(
              {
                kind: 'REJECT',
                packetId: payload.packetId,
                rejectCode: payload.rejectCode,
                rejectMessage: payload.rejectMessage,
                triggeredBy: payload.triggeredBy,
                data: payload.data
              },
              payload.peerId,
              payload.callbackDeadline
            )
          );
          break;
        }
        default:
          unhandled.push(msg.msgName);
          break;
      }
    }

    if (unhandled.length > 0) {
      this._logger.warn(
        `Unhandled connector command(s): ${[...new Set(unhandled)].join(', ')}`
      );
    }

    const results = await Promise.allSettled(dispatches);
    for (const result of results) {
      if (result.status === 'rejected') {
        this._logger.warn(
          `Connector command dispatch failed: ${result.reason}`
        );
      }
    }
  }

  // Called by OutboundExpiryWorker. Claims due packetIds from the shared
  // store, then takeOutboundCorrelation. If a peer callback already took the
  // entry, this is a no-op.
  async processExpiredOutboundPackets(): Promise<void> {
    const packetIds = await this._correlationStore.claimExpiredOutbound(100);
    for (const packetId of packetIds) {
      await this._handleWireResponse({
        kind: 'REJECT',
        packetId,
        rejectCode: 'R00',
        rejectMessage: 'no fulfill/reject callback received before expiry',
        triggeredBy: this._ilpAddress
      });
    }
  }

  private async _handleDispatchPrepare(
    payload: DispatchPreparePacketCmd['payload']
  ): Promise<void> {
    this._logger.debug(
      `Dispatch outbound prepare — packet ${payload.packetId} peer ${payload.peerId} amount ${payload.amount}`
    );
    await this._correlationStore.storeOutboundCorrelation(payload.packetId, {
      peerId: payload.peerId,
      paymentIntentId: payload.paymentIntentId,
      expiresAt: payload.expiresAt
    });

    await this._transport.sendPrepare({
      peerId: payload.peerId,
      packetId: payload.packetId,
      destinationIlpAddress: payload.destinationIlpAddress,
      amount: payload.amount,
      expiresAt: payload.expiresAt,
      executionCondition: payload.executionCondition,
      data: payload.data
    });
  }

  private async _onOutboundPrepareAccepted(
    prepare: WirePrepare
  ): Promise<void> {
    await this._correlationStore.scheduleOutboundExpiry(
      prepare.packetId,
      prepare.expiresAt
    );
  }

  private async _handleWireResponse(response: WireResponse): Promise<void> {
    this._logger.debug(
      `Wire response — ${response.kind} packet ${response.packetId}` +
        (response.kind === 'REJECT' ? ` rejectCode ${response.rejectCode}` : '')
    );
    await this._correlationStore.cancelOutboundExpiry(response.packetId);

    const correlation = await this._correlationStore.takeOutboundCorrelation(
      response.packetId
    );
    if (!correlation) {
      this._logger.warn(
        `Dropping wire response for unknown packetId ${response.packetId}`
      );
      return;
    }

    const common = {
      peerId: correlation.peerId,
      paymentIntentId: correlation.paymentIntentId,
      packetId: response.packetId
    };

    if (response.kind === 'FULFILL') {
      await this._producer.send(
        new ProcessFulfillPacketCmd({
          ...common,
          fulfilledAt: new Date().toISOString(),
          fulfillment: response.fulfillment,
          data: response.data
        })
      );
      return;
    }

    await this._producer.send(
      new ProcessRejectPacketCmd({
        ...common,
        rejectCode: response.rejectCode,
        rejectMessage: response.rejectMessage ?? '',
        rejectedAt: new Date().toISOString(),
        data: response.data
      })
    );
  }

  private async _handleInboundPrepare(prepare: WirePrepare): Promise<void> {
    this._logger.debug(
      `Inbound prepare — packet ${prepare.packetId} peer ${prepare.peerId} amount ${prepare.amount} dest ${prepare.destinationIlpAddress}`
    );

    await this._producer.send(
      new ProcessPreparePacketCmd({
        peerId: prepare.peerId,
        packetId: prepare.packetId,
        destinationIlpAddress: prepare.destinationIlpAddress,
        amount: prepare.amount,
        expiresAt: prepare.expiresAt,
        executionCondition: prepare.executionCondition,
        data: prepare.data
      })
    );
  }
}
