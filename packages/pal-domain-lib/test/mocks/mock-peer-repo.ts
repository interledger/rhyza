import { IPalPeerDto } from 'pal-public-types-lib';
import { IPalPeerRepository } from '../../src';

export class MockPeerRepo implements IPalPeerRepository {
  private _data: Map<string, IPalPeerDto> = new Map<string, IPalPeerDto>();

  store(peer: IPalPeerDto): Promise<void> {
    this._data.set(peer.id, peer);
    return Promise.resolve();
  }

  fetch(ids: string[]): Promise<IPalPeerDto[]> {
    const ret = Array.from(this._data.values()).filter((item) =>
      ids.includes(item.id)
    );

    return Promise.resolve(ret);
  }

  fetchByCommsMethodAndAddress(
    commType: 'ILP',
    staticAddress: string
  ): Promise<IPalPeerDto | null> {
    const ret = Array.from(this._data.values()).find(
      (item) =>
        item.communicationMethodDefinition.type === commType &&
        item.communicationMethodDefinition.staticAddress === staticAddress
    );

    return Promise.resolve(ret);
  }
}
