import { Any as PbAny } from 'google-protobuf/google/protobuf/any_pb';
import { ProtoBufBaseCommandSerializer } from 'implementations-lib';
import { CheckBalanceAndReserveTransferCmdPayload } from 'pal-domain-lib';
import { PbCheckBalanceAndReserveOrReserveTransferCmdPayload } from '../../../proto_generated';

export class CheckBalanceAndReserveCmdSerde extends ProtoBufBaseCommandSerializer<CheckBalanceAndReserveTransferCmdPayload> {
  protected _payloadPbClassName =
    'PbCheckBalanceAndReserveOrReserveTransferCmdPayload';
  msgName = 'CheckBalanceAndReserveCmd';

  protected _serializePayload(
    payload: CheckBalanceAndReserveTransferCmdPayload
  ): Uint8Array {
    const typedPayload = payload as CheckBalanceAndReserveTransferCmdPayload;

    const pbPayload = new PbCheckBalanceAndReserveOrReserveTransferCmdPayload();
    pbPayload.setRequestId(typedPayload.requestId);
    pbPayload.setPeerId(typedPayload.peerId);
    pbPayload.setAmount(typedPayload.amount);
    pbPayload.setAmountScale(typedPayload.amountScale);
    pbPayload.setPaymentId(typedPayload.paymentId);
    pbPayload.setPaymentIntentId(typedPayload.paymentIntentId);
    pbPayload.setTransferId(typedPayload.transferId);
    pbPayload.setTransferDirection(typedPayload.transferDirection);

    return pbPayload.serializeBinary();
  }

  protected _deserializePayload(
    pbAny: PbAny,
    msgName: string
  ): CheckBalanceAndReserveTransferCmdPayload {
    const pbPayload =
      pbAny.unpack<PbCheckBalanceAndReserveOrReserveTransferCmdPayload>(
        PbCheckBalanceAndReserveOrReserveTransferCmdPayload.deserializeBinary,
        msgName
      );
    if (!pbPayload) throw new Error('No payload found in message');

    const payload: CheckBalanceAndReserveTransferCmdPayload = {
      requestId: pbPayload.getRequestId(),
      peerId: pbPayload.getPeerId(),
      amount: pbPayload.getAmount(),
      amountScale: pbPayload.getAmountScale(),
      paymentId: pbPayload.getPaymentId(),
      paymentIntentId: pbPayload.getPaymentIntentId(),
      transferId: pbPayload.getTransferId(),
      transferDirection: pbPayload.getTransferDirection() as
        | 'INCOMING'
        | 'OUTGOING'
    };

    return payload;
  }
}

export class ReserveTransferCmdSerde extends CheckBalanceAndReserveCmdSerde {
  msgName = 'ReserveTransferCmd';
}
