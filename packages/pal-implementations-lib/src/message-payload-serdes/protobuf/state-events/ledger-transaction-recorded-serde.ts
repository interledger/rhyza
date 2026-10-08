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
    pbPayload.setOriginatingCommandName(
      typedPayload.transaction.originatingCommandName
    );
    pbPayload.setAmount(typedPayload.transaction.amount);
    pbPayload.setAmountScale(typedPayload.transaction.amountScale);
    pbPayload.setTimestamp(typedPayload.transaction.timestamp);

    pbPayload.setPeerId(typedPayload.transaction.peerId);
    pbPayload.setDebitedAccountId(typedPayload.transaction.debitedAccountId);
    pbPayload.setCreditedAccountId(typedPayload.transaction.creditedAccountId);
    pbPayload.setIsReservation(typedPayload.transaction.isReservation);
    pbPayload.setVoidsReservation(typedPayload.transaction.voidsReservation);

    if (typedPayload.transaction.externalId)
      pbPayload.setExternalId(typedPayload.transaction.externalId);

    if (typedPayload.transaction.transferId)
      pbPayload.setTransferId(typedPayload.transaction.transferId);

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
        creditedAccountId: pbPayload.getCreditedAccountId(),
        isReservation: pbPayload.getIsReservation(),
        voidsReservation: pbPayload.getVoidsReservation(),
        originatingCommandName: pbPayload.getOriginatingCommandName(),
        peerId: pbPayload.getPeerId(),
        externalId: undefined,
        transferId: undefined
      }
    };

    if (pbPayload.hasExternalId()) {
      payload.transaction.externalId = pbPayload.getExternalId();
    }
    if (pbPayload.hasTransferId()) {
      payload.transaction.transferId = pbPayload.getTransferId();
    }
    return payload;
  }
}
