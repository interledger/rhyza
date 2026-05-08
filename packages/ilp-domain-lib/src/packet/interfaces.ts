import { PacketState as PeerPacketState } from '../peer/interfaces';
import type {
  IPacketCorrelation as PeerPacketCorrelation,
  PacketState as PeerPacketStateType
} from '../peer/interfaces';

export const PacketState = PeerPacketState;
export type PacketState = PeerPacketStateType;
export type IPacketCorrelation = PeerPacketCorrelation;

export interface IPacketJournalRepository {
  fetchByIds(packetIds: string[]): Promise<IPacketCorrelation[]>;
  storeMany(packets: IPacketCorrelation[]): Promise<void>;
  updateMany(packets: IPacketCorrelation[]): Promise<void>;
}
