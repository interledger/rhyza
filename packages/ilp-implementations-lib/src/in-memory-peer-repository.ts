import { IPacketCorrelation, IPeer, IPeerRepository } from 'ilp-domain-lib';

export class InMemoryPeerRepository implements IPeerRepository {
  private readonly _peers = new Map<string, IPeer>();
  private readonly _packets = new Map<string, IPacketCorrelation>();

  constructor(seedPeers: IPeer[] = []) {
    for (const peer of seedPeers) {
      this._peers.set(peer.peerId, peer);
    }
  }

  async fetchById(peerId: string): Promise<IPeer | undefined> {
    return this._peers.get(peerId);
  }

  async fetchAll(): Promise<IPeer[]> {
    return Array.from(this._peers.values());
  }

  async store(peer: IPeer): Promise<void> {
    this._peers.set(peer.peerId, peer);
  }

  async update(peer: IPeer): Promise<void> {
    this._peers.set(peer.peerId, peer);
  }

  async fetchPacketById(
    packetId: string
  ): Promise<IPacketCorrelation | undefined> {
    return this._packets.get(packetId);
  }

  async storePacket(packet: IPacketCorrelation): Promise<void> {
    this._packets.set(packet.packetId, packet);
  }

  async updatePacket(packet: IPacketCorrelation): Promise<void> {
    this._packets.set(packet.packetId, packet);
  }
}
