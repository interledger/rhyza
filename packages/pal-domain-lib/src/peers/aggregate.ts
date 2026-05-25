import { ILogger } from 'common-types-lib';
import { IPalPeerRepository } from './interfaces';
import {
  CannotCreateDuplicatePeerError,
  PeerAlreadyActiveError,
  PeerAlreadyInactiveError,
  PeerNotFoundError
} from './errors';
import { IPalPeerCommunicationMethodDefinition, PalPeer } from './entity';
import {
  PeerActivatedEvent,
  PeerCreatedEvent,
  PeerDomainEvent
} from 'pal-public-types-lib';

export class PeerAggregate {
  private readonly _logger: ILogger;
  private readonly _repo: IPalPeerRepository;
  private readonly _uncommittedDomainEvents: PeerDomainEvent[];

  constructor(repo: IPalPeerRepository, logger: ILogger) {
    this._logger = logger;
    this._repo = repo;
    this._uncommittedDomainEvents = [];
  }

  get uncommittedDomainEvents(): PeerDomainEvent[] {
    return this._uncommittedDomainEvents;
  }

  clearUncommittedDomainEvents(): void {
    this._uncommittedDomainEvents.length = 0;
  }

  async createPeer(
    peerId: string,
    name: string,
    assetCode: string,
    assetScale: number,
    commMethod: IPalPeerCommunicationMethodDefinition
  ): Promise<void> {
    const existing = await this._repo.fetch([peerId]);

    if (existing.length > 0) {
      throw new CannotCreateDuplicatePeerError(
        'Peer with id: ' + peerId + ' already exists'
      );
    }

    const peer = new PalPeer(peerId, name, assetCode, assetScale);
    peer.setCommunicationMethodDefinition(commMethod);

    await this._repo.store(peer.toDto());
    this._uncommittedDomainEvents.push(
      new PeerCreatedEvent({ peerId: peerId, assetCode: assetCode })
    );
    this._logger.debug(`Peer ${peerId} and assetCode: ${assetCode} created`);
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

  async setCommunicationMethodDefinition(
    peerId: string,
    commMethod: IPalPeerCommunicationMethodDefinition
  ) {
    const found = await this._repo.fetch([peerId]);

    if (found.length == 0) {
      this._logger.warn(
        `Peer with id: ${peerId} not found in setCommunicationMethodDefinition()`
      );
      throw new PeerNotFoundError('Peer with id: ' + peerId + ' not found');
    }

    const peer = PalPeer.fromDto(found[0]);
    peer.setCommunicationMethodDefinition(commMethod);

    this._logger.info(
      `Peer ${peerId} communication method updated to ${commMethod}`
    );
    await this._repo.store(peer.toDto());
  }

  async associateLedgerAccountsAndActivate(
    peerId: string,
    peerLiquidityAccId: string,
    peerClearingAccId: string,
    aseLiquidityAccId: string,
    aseClearingAccId: string,
    suspenseAccId: string
  ): Promise<void> {
    const found = await this._repo.fetch([peerId]);

    if (found.length == 0) {
      this._logger.warn(
        `Peer with id: ${peerId} not found in associateLedgerAccountsAndActivate()`
      );
      throw new PeerNotFoundError('Peer with id: ' + peerId + ' not found');
    }

    const peer = PalPeer.fromDto(found[0]);
    peer.associateLedgerAccounts(
      peerLiquidityAccId,
      peerClearingAccId,
      aseLiquidityAccId,
      aseClearingAccId,
      suspenseAccId
    );
    peer.activate();

    await this._repo.store(peer.toDto());

    this._uncommittedDomainEvents.push(
      new PeerActivatedEvent({ peerId: peerId })
    );

    this._logger.debug(
      `Peer ${peerId} and assetCode: ${peer.assetCode} now has ledger accounts associated and has been activated`
    );
  }

  async activate(peerId: string): Promise<void> {
    const found = await this._repo.fetch([peerId]);

    if (found.length == 0) {
      this._logger.warn(`Peer with id: ${peerId} not found in activate()`);
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
      this._logger.warn(`Peer with id: ${peerId} not found in deactivate()`);
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
