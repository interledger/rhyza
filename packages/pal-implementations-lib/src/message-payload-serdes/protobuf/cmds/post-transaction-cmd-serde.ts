import { Any as PbAny } from 'google-protobuf/google/protobuf/any_pb';
import { ProtoBufBaseCommandSerializer } from 'implementations-lib';
import { PostTransactionCmdPayload } from 'pal-domain-lib';
import { PbPostTransactionCmdPayload } from '../../../proto_generated';

export class PostTransactionCmdSerde extends ProtoBufBaseCommandSerializer<PostTransactionCmdPayload> {
  protected _payloadPbClassName = 'PbCreateLedgerAccountCmdPayload';
  msgName = 'PostTransactionCmd';

  protected _serializePayload(payload: PostTransactionCmdPayload): Uint8Array {
    const typedPayload = payload as PostTransactionCmdPayload;

    const pbPayload = new PbPostTransactionCmdPayload();
    pbPayload.setId(typedPayload.id);
    pbPayload.setDebitedAccountId(typedPayload.debitedAccountId);
    pbPayload.setCreditedAccountId(typedPayload.creditedAccountId);
    pbPayload.setAmount(typedPayload.amount);
    pbPayload.setAmountScale(typedPayload.amountScale);

    return pbPayload.serializeBinary();
  }

  protected _deserializePayload(
    pbAny: PbAny,
    msgName: string
  ): PostTransactionCmdPayload {
    const pbPayload = pbAny.unpack<PbPostTransactionCmdPayload>(
      PbPostTransactionCmdPayload.deserializeBinary,
      msgName
    );
    if (!pbPayload) throw new Error('No payload found in message');

    const payload: PostTransactionCmdPayload = {
      id: pbPayload.getId(),
      debitedAccountId: pbPayload.getDebitedAccountId(),
      creditedAccountId: pbPayload.getCreditedAccountId(),
      amount: pbPayload.getAmount(),
      amountScale: pbPayload.getAmountScale()
    };

    return payload;
  }
}
