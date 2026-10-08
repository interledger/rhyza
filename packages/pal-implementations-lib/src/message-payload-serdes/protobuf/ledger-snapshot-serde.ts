import { Any as PbAny } from 'google-protobuf/google/protobuf/any_pb';
import { ProtoBufBaseSnapshotEventSerializer } from 'implementations-lib';
import { LedgerSnapshotPayload } from 'pal-domain-lib';
import {
  PbLedgerAccountState,
  PbLedgerPendingTransfer,
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
        pbAccount.setType(a.type);
        pbAccount.setName(a.name);
        pbAccount.setAssetCode(a.assetCode);
        pbAccount.setAssetDisplayScale(a.assetDisplayScale);
        pbAccount.setDebitedAmount(a.debitedAmount);
        pbAccount.setCreditedAmount(a.creditedAmount);
        return pbAccount;
      })
    );
    pbPayload.setPendingTransfersList(
      typedPayload.pendingTransfers.map((t) => {
        const pbPendingTransfer = new PbLedgerPendingTransfer();
        pbPendingTransfer.setTransferId(t.transferId);
        pbPendingTransfer.setPeerId(t.peerId);
        pbPendingTransfer.setAmount(t.amount);
        pbPendingTransfer.setAmountScale(t.amountScale);
        return pbPendingTransfer;
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
      pendingTransfers: [],
      assetScale: pbPayload.getAssetScale(),
      transactionCount: pbPayload.getTransactionCount().toString()
    };
    payload.accounts = pbPayload.getAccountsList().map((acc) => {
      return {
        id: acc.getId(),
        type: acc.getType() as
          | 'ASSET_LIQUIDITY_ACCOUNT'
          | 'PEER_LIQUIDITY_ACCOUNT'
          | 'PEER_CLEARING_ACCOUNT'
          | 'ASE_LIQUIDITY_ACCOUNT'
          | 'ASE_CLEARING_ACCOUNT'
          | 'SUSPENSE_ACCOUNT',
        name: acc.getName(),
        assetCode: acc.getAssetCode(),
        assetDisplayScale: acc.getAssetDisplayScale(),
        creditedAmount: acc.getCreditedAmount(),
        debitedAmount: acc.getDebitedAmount()
      };
    });

    payload.pendingTransfers = pbPayload.getPendingTransfersList().map((t) => {
      return {
        transferId: t.getTransferId(),
        peerId: t.getPeerId(),
        amount: t.getAmount(),
        amountScale: t.getAmountScale()
      };
    });

    return payload;
  }
}
