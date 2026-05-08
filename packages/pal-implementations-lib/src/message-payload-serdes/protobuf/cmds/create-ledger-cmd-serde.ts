import { Any as PbAny } from 'google-protobuf/google/protobuf/any_pb';
import { ProtoBufBaseCommandSerializer } from 'implementations-lib';
import { CreateLedgerCmdPayload } from 'pal-domain-lib';
import { PbCreateLedgerCmdPayload } from '../../../proto_generated';

export class CreateLedgerCmdSerde extends ProtoBufBaseCommandSerializer<CreateLedgerCmdPayload> {
  protected _payloadPbClassName = 'PbCreateLedgerCmdPayload';
  msgName = 'CreateLedgerCmd';

  protected _serializePayload(payload: CreateLedgerCmdPayload): Uint8Array {
    const typedPayload = payload as CreateLedgerCmdPayload;

    const pbPayload = new PbCreateLedgerCmdPayload();
    pbPayload.setLedgerId(typedPayload.id);

    return pbPayload.serializeBinary();
  }

  protected _deserializePayload(
    pbAny: PbAny,
    msgName: string
  ): CreateLedgerCmdPayload {
    const pbPayload = pbAny.unpack<PbCreateLedgerCmdPayload>(
      PbCreateLedgerCmdPayload.deserializeBinary,
      msgName
    );
    if (!pbPayload) throw new Error('No payload found in message');

    const payload: CreateLedgerCmdPayload = {
      id: pbPayload.getLedgerId()
    };

    return payload;
  }
}
