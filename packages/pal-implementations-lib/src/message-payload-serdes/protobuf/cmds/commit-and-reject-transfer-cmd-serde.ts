import { Any as PbAny } from 'google-protobuf/google/protobuf/any_pb';
import { ProtoBufBaseCommandSerializer } from 'implementations-lib';
import { CommitOrRejectTransferCmdPayload } from 'pal-domain-lib';
import { PbCommitOrRejectCmdPayload } from '../../../proto_generated';

export class CommitTransferCmdSerde extends ProtoBufBaseCommandSerializer<CommitOrRejectTransferCmdPayload> {
  protected _payloadPbClassName = 'PbCommitOrRejectCmdPayload';
  msgName = 'CommitTransferCmd';

  protected _serializePayload(
    payload: CommitOrRejectTransferCmdPayload
  ): Uint8Array {
    const typedPayload = payload as CommitOrRejectTransferCmdPayload;

    const pbPayload = new PbCommitOrRejectCmdPayload();
    pbPayload.setRequestId(typedPayload.requestId);
    pbPayload.setPaymentId(typedPayload.paymentId);
    pbPayload.setPaymentIntentId(typedPayload.paymentIntentId);
    pbPayload.setTransferId(typedPayload.transferId);
    pbPayload.setTransferDirection(typedPayload.transferDirection);

    return pbPayload.serializeBinary();
  }

  protected _deserializePayload(
    pbAny: PbAny,
    msgName: string
  ): CommitOrRejectTransferCmdPayload {
    const pbPayload = pbAny.unpack<PbCommitOrRejectCmdPayload>(
      PbCommitOrRejectCmdPayload.deserializeBinary,
      msgName
    );
    if (!pbPayload) throw new Error('No payload found in message');

    const payload: CommitOrRejectTransferCmdPayload = {
      requestId: pbPayload.getRequestId(),
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

export class RejectTransferCmdSerde extends CommitTransferCmdSerde {
  msgName = 'RejectTransferCmd';
}
