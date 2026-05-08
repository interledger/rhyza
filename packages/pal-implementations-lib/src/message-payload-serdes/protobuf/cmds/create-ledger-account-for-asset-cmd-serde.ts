import { Any as PbAny } from 'google-protobuf/google/protobuf/any_pb';
import { ProtoBufBaseCommandSerializer } from 'implementations-lib';
import { CreateLedgerAccountForAssetCmdPayload } from 'pal-domain-lib';
import { PbCreateLedgerAccountForAssetCmdPayload } from '../../../proto_generated';

export class CreateLedgerAccountForAssetCmdSerde extends ProtoBufBaseCommandSerializer<CreateLedgerAccountForAssetCmdPayload> {
  protected _payloadPbClassName = 'PbCreateLedgerAccountForAssetCmd';
  msgName = 'CreateLedgerAccountForAssetCmd';

  protected _serializePayload(
    payload: CreateLedgerAccountForAssetCmdPayload
  ): Uint8Array {
    const typedPayload = payload as CreateLedgerAccountForAssetCmdPayload;

    const pbPayload = new PbCreateLedgerAccountForAssetCmdPayload();
    pbPayload.setAccountId(typedPayload.id);
    pbPayload.setAssetCode(typedPayload.assetCode);

    return pbPayload.serializeBinary();
  }

  protected _deserializePayload(
    pbAny: PbAny,
    msgName: string
  ): CreateLedgerAccountForAssetCmdPayload {
    const pbPayload = pbAny.unpack<PbCreateLedgerAccountForAssetCmdPayload>(
      PbCreateLedgerAccountForAssetCmdPayload.deserializeBinary,
      msgName
    );
    if (!pbPayload) throw new Error('No payload found in message');

    const payload: CreateLedgerAccountForAssetCmdPayload = {
      id: pbPayload.getAccountId(),
      assetCode: pbPayload.getAssetCode()
    };

    return payload;
  }
}
