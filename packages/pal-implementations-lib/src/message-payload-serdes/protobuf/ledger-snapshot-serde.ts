import { Any as PbAny } from 'google-protobuf/google/protobuf/any_pb';
import { ProtoBufBaseSnapshotEventSerializer } from 'implementations-lib';
import { LedgerSnapshotPayload } from 'pal-domain-lib';
import {
  PbLedgerAccountState,
  PbLedgerSnapshotPayload
} from '../../proto_generated';

export class LedgerSnapshotSerde extends ProtoBufBaseSnapshotEventSerializer<LedgerSnapshotPayload> {
  protected _payloadPbClassName = 'PbLedgerSnapshotPayload';
  msgName = 'LedgerSnapshotEvent';

  protected _serializePayload(payload: LedgerSnapshotPayload): Uint8Array {
    const typedPayload = payload as LedgerSnapshotPayload;

    const pbPayload = new PbLedgerSnapshotPayload();
    pbPayload.setAssetScale(typedPayload.assetScale);
    pbPayload.setTransactionCount(Number(typedPayload.transactionCount));
    pbPayload.setAccountsList(
      typedPayload.accounts.map((a) => {
        const pbAccount = new PbLedgerAccountState();
        pbAccount.setId(a.id);
        pbAccount.setName(a.name);
        pbAccount.setAssetCode(a.assetCode);
        pbAccount.setAssetDisplayScale(a.assetDisplayScale);
        pbAccount.setDebitedAmount(a.debitedAmount);
        pbAccount.setCreditedAmount(a.creditedAmount);
        return pbAccount;
      })
    );

    return pbPayload.serializeBinary();
  }

  protected _deserializePayload(
    pbAny: PbAny,
    msgName: string
  ): LedgerSnapshotPayload {
    const pbPayload = pbAny.unpack<PbLedgerSnapshotPayload>(
      PbLedgerSnapshotPayload.deserializeBinary,
      msgName
    );
    if (!pbPayload) throw new Error('No payload found in message');

    const payload: LedgerSnapshotPayload = {
      accounts: [],
      assetScale: pbPayload.getAssetScale(),
      transactionCount: pbPayload.getTransactionCount().toString()
    };
    payload.accounts = pbPayload.getAccountsList().map((acc) => {
      return {
        id: acc.getId(),
        assetCode: acc.getAssetCode(),
        assetDisplayScale: acc.getAssetDisplayScale(),
        name: acc.getName(),
        creditedAmount: acc.getCreditedAmount(),
        debitedAmount: acc.getDebitedAmount()
      };
    });

    return payload;
  }
}
