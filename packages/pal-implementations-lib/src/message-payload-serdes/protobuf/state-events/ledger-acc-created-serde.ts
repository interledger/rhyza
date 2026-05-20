import { Any as PbAny } from 'google-protobuf/google/protobuf/any_pb';
import { LedgerAccountsCreatedStatePayload } from 'pal-domain-lib';
import {
  PbLedgerAccountsCreatedStatePayload,
  PbLedgerAccountState
} from '../../../proto_generated';
import { ProtoBufBaseStateEventSerializer } from 'implementations-lib';

export class LedgerAccountsCreatedStateEventSerde extends ProtoBufBaseStateEventSerializer<LedgerAccountsCreatedStatePayload> {
  protected _payloadPbClassName = 'PbLedgerAccountsCreatedStatePayload';
  msgName = 'LedgerAccountsCreatedStateEvent';

  protected _serializePayload(
    payload: LedgerAccountsCreatedStatePayload
  ): Uint8Array {
    const typedPayload = payload as LedgerAccountsCreatedStatePayload;

    const pbPayload = new PbLedgerAccountsCreatedStatePayload();

    const pbAccountsList: PbLedgerAccountState[] = [];
    typedPayload.accounts.forEach((acc) => {
      const pbAccount = new PbLedgerAccountState();
      pbAccount.setId(acc.id);
      pbAccount.setName(acc.name);
      pbAccount.setAssetCode(acc.assetCode);
      pbAccount.setAssetDisplayScale(acc.assetDisplayScale);
      pbAccount.setDebitedAmount(acc.debitedAmount);
      pbAccount.setCreditedAmount(acc.creditedAmount);
      pbAccountsList.push(pbAccount);
    });
    pbPayload.setAccountsList(pbAccountsList);

    return pbPayload.serializeBinary();
  }

  protected _deserializePayload(
    pbAny: PbAny,
    msgName: string
  ): LedgerAccountsCreatedStatePayload {
    const pbPayload = pbAny.unpack<PbLedgerAccountsCreatedStatePayload>(
      PbLedgerAccountsCreatedStatePayload.deserializeBinary,
      msgName
    );
    if (!pbPayload) throw new Error('No payload found in message');

    const pbAccounts = pbPayload.getAccountsList();
    if (!pbAccounts || pbAccounts.length == 0)
      throw new Error('No account found in payload');

    const payload: LedgerAccountsCreatedStatePayload = {
      accounts: pbAccounts.map((account) => {
        return {
          id: account.getId(),
          assetCode: account.getAssetCode(),
          assetDisplayScale: account.getAssetDisplayScale(),
          name: account.getName(),
          creditedAmount: account.getCreditedAmount(),
          debitedAmount: account.getDebitedAmount()
        };
      })
    };

    return payload;
  }
}
