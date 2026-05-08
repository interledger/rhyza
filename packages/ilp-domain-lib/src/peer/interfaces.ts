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

export const PacketState = {
  PENDING: 'PENDING',
  FULFILLED: 'FULFILLED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED'
} as const;
export type PacketState = keyof typeof PacketState;

export interface IPacketCorrelation {
  packetId: string;
  peerId: string;
  paymentIntentId: string;
  expiresAt: Date;
  state: PacketState;
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
}
