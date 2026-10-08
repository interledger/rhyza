import { Any as PbAny } from 'google-protobuf/google/protobuf/any_pb';
import { ProtoBufBaseCommandSerializer } from 'implementations-lib';
import { PbLiquidityManagementCmdPayload } from '../../../proto_generated';
import { LiquidityManagementCmdPayload } from 'pal-domain-lib';

export class DepositToAseCmdSerde extends ProtoBufBaseCommandSerializer<LiquidityManagementCmdPayload> {
  protected _payloadPbClassName = 'PbLiquidityManagementCmdPayload';
  msgName = 'DepositToAseCmd';

  protected _serializePayload(
    payload: LiquidityManagementCmdPayload
  ): Uint8Array {
    const typedPayload = payload as LiquidityManagementCmdPayload;

    const pbPayload = new PbLiquidityManagementCmdPayload();
    pbPayload.setRequestId(typedPayload.requestId);
    pbPayload.setPeerId(typedPayload.peerId);
    pbPayload.setAmount(typedPayload.amount);
    pbPayload.setAmountScale(typedPayload.amountScale);
    pbPayload.setAssetCode(typedPayload.assetCode);
    if (typedPayload.externalId !== undefined) {
      pbPayload.setExternalId(typedPayload.externalId);
    }

    return pbPayload.serializeBinary();
  }

  protected _deserializePayload(
    pbAny: PbAny,
    msgName: string
  ): LiquidityManagementCmdPayload {
    const pbPayload = pbAny.unpack<PbLiquidityManagementCmdPayload>(
      PbLiquidityManagementCmdPayload.deserializeBinary,
      msgName
    );
    if (!pbPayload) throw new Error('No payload found in message');

    const payload: LiquidityManagementCmdPayload = {
      requestId: pbPayload.getRequestId(),
      peerId: pbPayload.getPeerId(),
      amount: pbPayload.getAmount(),
      amountScale: pbPayload.getAmountScale(),
      assetCode: pbPayload.getAssetCode()
    };
    if (pbPayload.hasExternalId()) {
      payload.externalId = pbPayload.getExternalId();
    }

    return payload;
  }
}

export class WithdrawFromAseCmdSerde extends DepositToAseCmdSerde {
  msgName = 'WithdrawFromAseCmd';
}
export class DepositToPeerCmdSerde extends DepositToAseCmdSerde {
  msgName = 'DepositToPeerCmd';
}
export class WithdrawFromPeerCmdSerde extends DepositToAseCmdSerde {
  msgName = 'WithdrawFromPeerCmd';
}
