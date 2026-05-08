import { Any as PbAny } from 'google-protobuf/google/protobuf/any_pb';
import { LedgerAccountCreatedStatePayload } from 'pal-domain-lib';
import {
  PbLedgerAccountCreatedStatePayload,
  PbLedgerAccountState
} from '../../../proto_generated';
import { ProtoBufBaseStateEventSerializer } from 'implementations-lib';

export class LedgerAccountCreatedStateEventSerde extends ProtoBufBaseStateEventSerializer<LedgerAccountCreatedStatePayload> {
  protected _payloadPbClassName = 'PbLedgerAccountCreatedStatePayload';
  msgName = 'LedgerAccountCreatedStateEvent';

  protected _serializePayload(
    payload: LedgerAccountCreatedStatePayload
  ): Uint8Array {
    const typedPayload = payload as LedgerAccountCreatedStatePayload;

    const pbAccount = new PbLedgerAccountState();
    pbAccount.setId(typedPayload.account.id);
    pbAccount.setName(typedPayload.account.name);
    pbAccount.setAssetCode(typedPayload.account.assetCode);
    pbAccount.setAssetDisplayScale(typedPayload.account.assetDisplayScale);
    pbAccount.setDebitedAmount(typedPayload.account.debitedAmount);
    pbAccount.setCreditedAmount(typedPayload.account.creditedAmount);

    const pbPayload = new PbLedgerAccountCreatedStatePayload();
    pbPayload.setAccount(pbAccount);

    return pbPayload.serializeBinary();
  }

  protected _deserializePayload(
    pbAny: PbAny,
    msgName: string
  ): LedgerAccountCreatedStatePayload {
    const pbPayload = pbAny.unpack<PbLedgerAccountCreatedStatePayload>(
      PbLedgerAccountCreatedStatePayload.deserializeBinary,
      msgName
    );
    if (!pbPayload) throw new Error('No payload found in message');

    const account = pbPayload.getAccount();
    if (!account) throw new Error('No account found in payload');

    const payload: LedgerAccountCreatedStatePayload = {
      account: {
        id: account.getId(),
        assetCode: account.getAssetCode(),
        assetDisplayScale: account.getAssetDisplayScale(),
        name: account.getName(),
        creditedAmount: account.getCreditedAmount(),
        debitedAmount: account.getDebitedAmount()
      }
    };

    return payload;
  }
}
