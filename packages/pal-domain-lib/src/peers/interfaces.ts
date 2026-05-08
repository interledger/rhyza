import { IPalPeerDto } from 'pal-public-types-lib';

export interface IPalPeerRepository {
  store(asset: IPalPeerDto): Promise<void>;
  fetch(ids: string[]): Promise<IPalPeerDto[]>;
  fetchByCommsMethodAndAddress(
    commType: 'ILP',
    staticAddress: string
  ): Promise<IPalPeerDto | null>;
}
