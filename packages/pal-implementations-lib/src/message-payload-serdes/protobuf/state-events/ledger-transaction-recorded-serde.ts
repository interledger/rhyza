import { Any as PbAny } from 'google-protobuf/google/protobuf/any_pb';
import { ProtoBufBaseStateEventSerializer } from 'implementations-lib';
import { LedgerTransactionRecordedStatePayload } from 'pal-domain-lib';
import { PbLedgerTransactionRecordedStatePayload } from '../../../proto_generated';

export class LedgerTransactionRecordedStateEventSerde extends ProtoBufBaseStateEventSerializer<LedgerTransactionRecordedStatePayload> {
  protected _payloadPbClassName = 'PbLedgerTransactionRecordedStatePayload';
  msgName = 'LedgerTransactionRecordedStateEvent';

  protected _serializePayload(
    payload: LedgerTransactionRecordedStatePayload
  ): Uint8Array {
    const typedPayload = payload as LedgerTransactionRecordedStatePayload;

    const pbPayload = new PbLedgerTransactionRecordedStatePayload();
    pbPayload.setId(typedPayload.transaction.id);
    pbPayload.setAmount(typedPayload.transaction.amount);
    pbPayload.setAmountScale(typedPayload.transaction.amountScale);
    pbPayload.setTimestamp(typedPayload.transaction.timestamp);

    pbPayload.setDebitedAccountId(typedPayload.transaction.debitedAccountId);
    pbPayload.setCreditedAccountId(typedPayload.transaction.creditedAccountId);

    return pbPayload.serializeBinary();
  }

  protected _deserializePayload(
    pbAny: PbAny,
    msgName: string
  ): LedgerTransactionRecordedStatePayload {
    const pbPayload = pbAny.unpack<PbLedgerTransactionRecordedStatePayload>(
      PbLedgerTransactionRecordedStatePayload.deserializeBinary,
      msgName
    );
    if (!pbPayload) throw new Error('No payload found in message');

    const payload: LedgerTransactionRecordedStatePayload = {
      transaction: {
        id: pbPayload.getId(),
        amount: pbPayload.getAmount(),
        amountScale: pbPayload.getAmountScale(),
        timestamp: pbPayload.getTimestamp(),
        debitedAccountId: pbPayload.getDebitedAccountId(),
        creditedAccountId: pbPayload.getCreditedAccountId()
      }
    };

    return payload;
  }
}
