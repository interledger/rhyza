import type { IPacketCorrelation } from '../packet/interfaces';

// ILP peer connector configuration
// The ILP BC only owns the connector configuration needed to exchange packets
// with the peer. `peerId` references the PAL peer.

export interface PeerHttpOutgoingConfig {
  endpoint: string;
  authToken: string;
}

export interface PeerHttpIncomingConfig {
  authToken?: string;
}

export interface PeerHttpConfig {
  outgoing: PeerHttpOutgoingConfig;
  incoming?: PeerHttpIncomingConfig;
}

export interface IPeer {
  peerId: string;
  http: PeerHttpConfig;
  isActive?: boolean;
  packetCorrelations?: IPacketCorrelation[];
}

export interface IPeerRepository {
  fetchById(peerId: string): Promise<IPeer | undefined>;
  store(peer: IPeer): Promise<void>;
  update(peer: IPeer): Promise<void>;
  fetchPacketById(packetId: string): Promise<IPacketCorrelation | undefined>;
  storePacket(packet: IPacketCorrelation): Promise<void>;
  updatePacket(packet: IPacketCorrelation): Promise<void>;
}
