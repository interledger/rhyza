import { ILogger, ConsoleLogger, IMessageProducer } from 'common-types-lib';
import {
  DispatchFulfillPacketCmd,
  DispatchPreparePacketCmd,
  DispatchRejectPacketCmd,
  FulfillDispatch,
  IPeeringClient,
  PacketDispatch,
  RejectDispatch
} from 'ilp-domain-lib';

export class KafkaPeeringClient implements IPeeringClient {
  constructor(
    private readonly _producer: IMessageProducer,
    private readonly _logger: ILogger = new ConsoleLogger()
  ) {}

  async dispatch(input: PacketDispatch): Promise<void> {
    const isPayment = input.type === 'PAYMENT';
    const cmd = new DispatchPreparePacketCmd({
      peerId: input.peerId,
      packetId: input.packetId,
      paymentIntentId: input.paymentIntentId,
      destinationIlpAddress: input.destinationIlpAddress,
      amount: isPayment ? input.amount : input.sourceAmount,
      expiresAt: input.expiresAt,
      executionCondition: isPayment
        ? input.executionCondition
        : Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
            'base64'
          ),
      data: input.data
    });

    this._logger.debug(
      `Dispatching ${input.type} prepare for packet ${input.packetId} to peer ${input.peerId}`
    );
    await this._producer.send(cmd);
  }

  async dispatchReject(input: RejectDispatch): Promise<void> {
    const cmd = new DispatchRejectPacketCmd({
      peerId: input.peerId,
      packetId: input.packetId,
      callbackDeadline: input.callbackDeadline,
      rejectCode: input.rejectCode,
      rejectMessage: input.rejectMessage,
      triggeredBy: input.triggeredBy,
      data: input.data
    });

    this._logger.debug(
      `Dispatching reject (${input.rejectCode}) for packet ${input.packetId} to peer ${input.peerId}`
    );
    await this._producer.send(cmd);
  }

  async dispatchFulfill(input: FulfillDispatch): Promise<void> {
    const cmd = new DispatchFulfillPacketCmd({
      peerId: input.peerId,
      packetId: input.packetId,
      callbackDeadline: input.callbackDeadline,
      fulfillment: input.fulfillment,
      data: input.data
    });

    this._logger.debug(
      `Dispatching fulfill for packet ${input.packetId} to peer ${input.peerId}`
    );
    await this._producer.send(cmd);
  }
}
