import { Any as PbAny } from 'google-protobuf/google/protobuf/any_pb';
import { ProtoBufBaseCommandSerializer } from 'implementations-lib';
import { CreateLedgerAccountForPeerCmdPayload } from 'pal-domain-lib';
import { PbCreateLedgerAccountForPeerCmdPayload } from '../../../proto_generated';

export class CreateLedgerAccountForPeerCmdSerde extends ProtoBufBaseCommandSerializer<CreateLedgerAccountForPeerCmdPayload> {
  protected _payloadPbClassName = 'PbCreateLedgerAccountForPeerCmd';
  msgName = 'CreateLedgerAccountForPeerCmd';

  protected _serializePayload(
    payload: CreateLedgerAccountForPeerCmdPayload
  ): Uint8Array {
    const typedPayload = payload as CreateLedgerAccountForPeerCmdPayload;

    const pbPayload = new PbCreateLedgerAccountForPeerCmdPayload();
    pbPayload.setAccountId(typedPayload.id);
    pbPayload.setAssetCode(typedPayload.assetCode);
    pbPayload.setPeerId(typedPayload.peerId);

    return pbPayload.serializeBinary();
  }

  protected _deserializePayload(
    pbAny: PbAny,
    msgName: string
  ): CreateLedgerAccountForPeerCmdPayload {
    const pbPayload = pbAny.unpack<PbCreateLedgerAccountForPeerCmdPayload>(
      PbCreateLedgerAccountForPeerCmdPayload.deserializeBinary,
      msgName
    );
    if (!pbPayload) throw new Error('No payload found in message');

    const payload: CreateLedgerAccountForPeerCmdPayload = {
      id: pbPayload.getAccountId(),
      assetCode: pbPayload.getAssetCode(),
      peerId: pbPayload.getPeerId()
    };

    return payload;
  }
}
