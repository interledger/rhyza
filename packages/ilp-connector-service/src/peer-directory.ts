import { IMessage } from 'common-types-lib';
import {
  ILPPeerCreatedEvent,
  ILPPeerUpdatedEvent,
  IPeer,
  PeerHttpConfig
} from 'ilp-domain-lib';

// Read-only peer connector config, built from ILP domain events.
//
// On boot the directory consumer uses auto.offset.reset=earliest so a fresh
// or restarted replica rebuilds from the full topic. There is still no
// repository backfill path if the topic was compacted away.
export class PeerDirectory {
  private readonly _peers = new Map<string, IPeer>();

  upsertFromEvent(message: IMessage): void {
    if (
      message.msgName !== ILPPeerCreatedEvent.name &&
      message.msgName !== ILPPeerUpdatedEvent.name
    ) {
      return;
    }
    const payload = message.payload as
      | ILPPeerCreatedEvent['payload']
      | ILPPeerUpdatedEvent['payload'];
    this._peers.set(payload.peerId, {
      peerId: payload.peerId,
      http: payload.http,
      isActive: payload.isActive,
      maxPacketAmount: payload.maxPacketAmount
    });
  }

  getOutgoing(peerId: string): PeerHttpConfig['outgoing'] | undefined {
    return this._peers.get(peerId)?.http.outgoing;
  }

  isActive(peerId: string): boolean {
    return this._peers.get(peerId)?.isActive !== false;
  }

  resolvePeerIdByIncomingToken(token: string): string | undefined {
    for (const peer of this._peers.values()) {
      if (peer.http.incoming?.authToken === token) {
        return peer.peerId;
      }
    }
    return undefined;
  }

  get size(): number {
    return this._peers.size;
  }
}
