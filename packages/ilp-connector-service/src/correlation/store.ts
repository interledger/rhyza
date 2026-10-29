import { OutboundPacketCorrelation } from './types';

export interface ITransportCorrelationStore {
  storeOutboundCorrelation(
    packetId: string,
    correlation: OutboundPacketCorrelation
  ): Promise<void>;
  hasOutboundCorrelation(packetId: string): Promise<boolean>;
  takeOutboundCorrelation(
    packetId: string
  ): Promise<OutboundPacketCorrelation | undefined>;
}
