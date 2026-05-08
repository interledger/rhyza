import { ILogger } from 'common-types-lib';
import { IPalPeerRepository } from './interfaces';
import {
  CannotCreateDuplicatePeerError,
  PeerAlreadyActiveError,
  PeerAlreadyInactiveError,
  PeerNotFoundError
} from './errors';
import { IPalPeerCommunicationMethod, PalPeer } from './entity';

export class PeerAggregate {
  private readonly _logger: ILogger;
  private readonly _repo: IPalPeerRepository;

  constructor(repo: IPalPeerRepository, logger: ILogger) {
    this._logger = logger;
    this._repo = repo;
  }

  async createPeer(
    peerId: string,
    name: string,
    assetCode: string,
    assetScale: number
  ): Promise<void> {
    const existing = await this._repo.fetch([peerId]);

    if (existing.length > 0) {
      throw new CannotCreateDuplicatePeerError(
        'Peer with id: ' + peerId + ' already exists'
      );
    }
    // TODO: check duplicate peer name?

    const peer = new PalPeer(peerId, name, assetCode, assetScale);

    return this._repo.store(peer.toDto());
  }

  async getPeer(peerId: string): Promise<PalPeer | null> {
    const found = await this._repo.fetch([peerId]);

    if (found.length == 0) {
      return null;
    }

    return PalPeer.fromDto(found[0]);
  }

  async getPeerByIlpAddress(staticAddress: string): Promise<PalPeer | null> {
    const found = await this._repo.fetchByCommsMethodAndAddress(
      'ILP',
      staticAddress
    );

    if (!found) {
      return null;
    }

    return PalPeer.fromDto(found);
  }

  async setCommunicationMethod(
    peerId: string,
    commMethod: IPalPeerCommunicationMethod
  ) {
    const found = await this._repo.fetch([peerId]);

    if (found.length == 0) {
      throw new PeerNotFoundError('Peer with id: ' + peerId + ' not found');
    }

    const peer = PalPeer.fromDto(found[0]);
    peer.setCommunicationMethod(commMethod);

    this._logger.info(
      `Peer ${peerId} communication method updated to ${commMethod}`
    );
    await this._repo.store(peer.toDto());
  }

  async associateLedgerAccount(
    peerId: string,
    ledgerAccountId: string
  ): Promise<void> {
    const found = await this._repo.fetch([peerId]);

    if (found.length == 0) {
      throw new PeerNotFoundError('Peer with id: ' + peerId + ' not found');
    }

    const peer = PalPeer.fromDto(found[0]);
    peer.associateLedgerAccount(ledgerAccountId);
    await this._repo.store(peer.toDto());
  }

  async activate(peerId: string): Promise<void> {
    const found = await this._repo.fetch([peerId]);

    if (found.length == 0) {
      throw new PeerNotFoundError('Peer with id: ' + peerId + ' not found');
    }

    const peer = PalPeer.fromDto(found[0]);
    if (peer.active) {
      throw new PeerAlreadyActiveError(`Peer ${peerId} is already active`);
    } else {
      peer.activate();
    }

    this._logger.info(`Peer ${peerId} activated`);
    await this._repo.store(peer.toDto());
  }

  async deactivate(peerId: string): Promise<void> {
    const found = await this._repo.fetch([peerId]);

    if (found.length == 0) {
      throw new PeerNotFoundError('Peer with id: ' + peerId + ' not found');
    }

    const peer = PalPeer.fromDto(found[0]);
    if (!peer.active) {
      throw new PeerAlreadyInactiveError(`Peer ${peerId} is not active`);
    } else {
      peer.deactivate();
    }

    this._logger.info(`Peer ${peerId} deactivated`);
    await this._repo.store(peer.toDto());
  }
}
