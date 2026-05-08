import { Any as PbAny } from 'google-protobuf/google/protobuf/any_pb';
import { ProtoBufBaseCommandSerializer } from 'implementations-lib';
import { CreateLedgerAccountCmdPayload } from 'pal-domain-lib';
import { PbCreateLedgerAccountCmdPayload } from '../../../proto_generated';

export class CreateLedgerAccountCmdSerde extends ProtoBufBaseCommandSerializer<CreateLedgerAccountCmdPayload> {
  protected _payloadPbClassName = 'PbCreateLedgerAccountCmdPayload';
  msgName = 'CreateLedgerAccountCmd';

  protected _serializePayload(
    payload: CreateLedgerAccountCmdPayload
  ): Uint8Array {
    const typedPayload = payload as CreateLedgerAccountCmdPayload;

    const pbPayload = new PbCreateLedgerAccountCmdPayload();
    pbPayload.setAccountId(typedPayload.id);
    pbPayload.setAssetCode(typedPayload.assetCode);
    if (typedPayload.assetDisplayScale) {
      pbPayload.setAssetDisplayScale(typedPayload.assetDisplayScale);
    }
    pbPayload.setName(typedPayload.name);

    return pbPayload.serializeBinary();
  }

  protected _deserializePayload(
    pbAny: PbAny,
    msgName: string
  ): CreateLedgerAccountCmdPayload {
    const pbPayload = pbAny.unpack<PbCreateLedgerAccountCmdPayload>(
      PbCreateLedgerAccountCmdPayload.deserializeBinary,
      msgName
    );
    if (!pbPayload) throw new Error('No payload found in message');

    const payload: CreateLedgerAccountCmdPayload = {
      id: pbPayload.getAccountId(),
      assetCode: pbPayload.getAssetCode(),
      assetDisplayScale: pbPayload.getAssetDisplayScale(),
      name: pbPayload.getName()
    };

    return payload;
  }
}
