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
import { InFlightCorrelations } from './in-flight-map';
import { IConnectorTransport, WirePrepare, WireResponse } from './transport';

export class IlpConnector {
  private readonly _inFlight = new InFlightCorrelations();

  constructor(
    private readonly _producer: IMessageProducer,
    private readonly _transport: IConnectorTransport,
    private readonly _logger: ILogger = new ConsoleLogger()
  ) {}

  init(): void {
    this._transport.onResponse((response) =>
      this._handleWireResponse(response)
    );
    this._transport.onInboundPrepare((prepare) =>
      this._handleInboundPrepare(prepare)
    );
  }

  async handleConnectorCommands(messages: IMessage[]): Promise<void> {
    const unhandled: string[] = [];

    for (const msg of messages) {
      if (msg.msgType !== MessageTypes.COMMAND) continue;

      switch (msg.msgName) {
        case DispatchPreparePacketCmd.name:
          await this._handleDispatchPrepare(
            (msg as DispatchPreparePacketCmd).payload
          );
          break;
        case DispatchFulfillPacketCmd.name: {
          const payload = (msg as DispatchFulfillPacketCmd).payload;
          await this._transport.sendFulfill({
            peerId: payload.peerId,
            packetId: payload.packetId,
            fulfillment: payload.fulfillment,
            data: payload.data
          });
          break;
        }
        case DispatchRejectPacketCmd.name: {
          const payload = (msg as DispatchRejectPacketCmd).payload;
          await this._transport.sendReject({
            peerId: payload.peerId,
            packetId: payload.packetId,
            rejectCode: payload.rejectCode,
            rejectMessage: payload.rejectMessage,
            data: payload.data
          });
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
  }

  get inFlightCount(): number {
    return this._inFlight.size;
  }

  private async _handleDispatchPrepare(
    payload: DispatchPreparePacketCmd['payload']
  ): Promise<void> {
    // Record the correlation before the packet leaves so a fast response can
    // never arrive before we can match it.
    this._inFlight.add(payload.packetId, {
      peerId: payload.peerId,
      paymentIntentId: payload.paymentIntentId
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

  private async _handleWireResponse(response: WireResponse): Promise<void> {
    const correlation = this._inFlight.take(response.packetId);
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
          fulfilledAt: new Date().toISOString()
        })
      );
      return;
    }

    await this._producer.send(
      new ProcessRejectPacketCmd({
        ...common,
        rejectCode: response.rejectCode,
        rejectMessage: response.rejectMessage ?? '',
        rejectedAt: new Date().toISOString()
      })
    );
  }

  private async _handleInboundPrepare(prepare: WirePrepare): Promise<void> {
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
