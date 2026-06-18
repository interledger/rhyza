import { ILogger } from 'common-types-lib';
import {
  IPalPeerAseFxService,
  IPalPeerFxCacheExpiryService,
  IPalPeerRepository
} from './interfaces';
import {
  CannotCreateDuplicatePeerError,
  InvalidFxRateError,
  PeerAlreadyActiveError,
  PeerAlreadyInactiveError,
  PeerNotFoundError
} from './errors';
import { IPalPeerCommunicationMethodDefinition, PalPeer } from './entity';
import {
  PeerActivatedEvent,
  PeerCreatedEvent,
  PeerCreationCompletedEvent,
  PeerDeactivatedEvent,
  PeerDomainEvent
} from 'pal-public-types-lib';

export class PeerAggregate {
  private readonly _logger: ILogger;
  private readonly _repo: IPalPeerRepository;
  private readonly _aseService: IPalPeerAseFxService;
  private readonly _uncommittedDomainEvents: PeerDomainEvent[];
  private readonly _fxCacheExpiryService: IPalPeerFxCacheExpiryService;

  constructor(
    repo: IPalPeerRepository,
    aseService: IPalPeerAseFxService,
    fxCacheExpiryService: IPalPeerFxCacheExpiryService,
    logger: ILogger
  ) {
    this._logger = logger;
    this._repo = repo;
    this._aseService = aseService;
    this._fxCacheExpiryService = fxCacheExpiryService;
    this._uncommittedDomainEvents = [];
  }

  private async _fetchOrThrow(peerId: string): Promise<PalPeer> {
    const found = await this._repo.fetch([peerId]);

    if (found.length == 0) {
      this._logger.warn(
        `Peer with id: ${peerId} not found in associateLedgerAccountsAndActivate()`
      );
      throw new PeerNotFoundError('Peer with id: ' + peerId + ' not found');
    }

    return PalPeer.fromDto(found[0]);
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
    const peer = await this._fetchOrThrow(peerId);

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
    const peer = await this._fetchOrThrow(peerId);

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
      new PeerCreationCompletedEvent({ peerId: peerId })
    );

    this._logger.debug(
      `Peer ${peerId} and assetCode: ${peer.assetCode} now has ledger accounts associated and has been activated`
    );
  }

  async activate(peerId: string): Promise<void> {
    const peer = await this._fetchOrThrow(peerId);

    if (peer.active) {
      throw new PeerAlreadyActiveError(`Peer ${peerId} is already active`);
    } else {
      peer.activate();
      this._uncommittedDomainEvents.push(
        new PeerActivatedEvent({ peerId: peerId })
      );
    }

    this._logger.info(`Peer ${peerId} activated`);
    await this._repo.store(peer.toDto());
  }

  async deactivate(peerId: string): Promise<void> {
    const peer = await this._fetchOrThrow(peerId);

    if (!peer.active) {
      throw new PeerAlreadyInactiveError(`Peer ${peerId} is not active`);
    } else {
      peer.deactivate();
      this._uncommittedDomainEvents.push(
        new PeerDeactivatedEvent({ peerId: peerId })
      );
    }

    this._logger.info(`Peer ${peerId} deactivated`);
    await this._repo.store(peer.toDto());
  }

  async setFxRate(
    peerId: string,
    sourceAssetCode: string,
    destinationAsset: string,
    rate: number,
    expiresAt: number | null
  ): Promise<void> {
    const peer = await this._fetchOrThrow(peerId);

    if (sourceAssetCode === peer.assetCode) {
      peer.setFxRateToDestinationAsset(
        destinationAsset,
        expiresAt,
        rate,
        false
      );
    } else if (destinationAsset === peer.assetCode) {
      peer.setFxRateFromSourceAsset(sourceAssetCode, expiresAt, rate, false);
    } else {
      throw new InvalidFxRateError(
        'Invalid source or asset codes on FX, one must match the peer asset code'
      );
    }

    await this._repo.store(peer.toDto());
  }

  async getFxFromSourceAsset(
    peerId: string,
    sourceAssetCode: string
  ): Promise<number | null> {
    const peer = await this._fetchOrThrow(peerId);
    const localRate = peer.getFxFromSourceAsset(sourceAssetCode);

    if (localRate) {
      return localRate;
    }

    const aseRate = await this._fetchAseRate(sourceAssetCode, peer.assetCode);
    if (!aseRate) {
      return null;
    }

    peer.setFxRateFromSourceAsset(
      sourceAssetCode,
      aseRate.expiresAt,
      aseRate.rate,
      true
    );
    await this._repo.store(peer.toDto());

    // set expiration timer
    await this._fxCacheExpiryService.setExpiry(
      peerId,
      sourceAssetCode,
      peer.assetCode,
      aseRate.expiresAt
    );

    return aseRate.rate;
  }

  async getFxToDestinationAsset(
    peerId: string,
    destinationAssetCode: string
  ): Promise<number | null> {
    const peer = await this._fetchOrThrow(peerId);
    const localRate = peer.getFxToDestinationAsset(destinationAssetCode);

    if (localRate) {
      return localRate;
    }

    const aseRate = await this._fetchAseRate(
      peer.assetCode,
      destinationAssetCode
    );
    if (!aseRate) {
      return null;
    }

    peer.setFxRateToDestinationAsset(
      destinationAssetCode,
      aseRate.expiresAt,
      aseRate.rate,
      true
    );
    await this._repo.store(peer.toDto());

    // set expiration timer
    await this._fxCacheExpiryService.setExpiry(
      peerId,
      peer.assetCode,
      destinationAssetCode,
      aseRate.expiresAt
    );

    return aseRate.rate;
  }

  private async _fetchAseRate(
    sourceAssetCode: string,
    destinationAssetCode: string
  ): Promise<{ rate: number; expiresAt: number } | null> {
    try {
      const aseRate = await this._aseService.getFxFromAse(
        sourceAssetCode,
        destinationAssetCode
      );
      return aseRate;
    } catch (e) {
      this._logger.error(
        e,
        `Failed to get ASE FX rate from ${sourceAssetCode} to ${destinationAssetCode}`
      );
      return null;
    }
  }

  async notifyExpiredFxRate(
    peerId: string,
    sourceAssetCode: string,
    destinationAssetCode: string
  ): Promise<void> {
    const peer = await this._fetchOrThrow(peerId);
    const currentRateRec = peer.getFxRate(
      sourceAssetCode,
      destinationAssetCode
    );

    if (
      !currentRateRec ||
      !currentRateRec.fetchedFromAse ||
      !currentRateRec.fetchedAt ||
      currentRateRec.fetchedAt >= Date.now()
    ) {
      // rate doesn't exist, was set by ASE, or was pre-fetched recently
      return;
    }

    if (sourceAssetCode === peer.assetCode) {
      await this.getFxToDestinationAsset(peerId, destinationAssetCode);
    } else if (destinationAssetCode === peer.assetCode) {
      await this.getFxFromSourceAsset(peerId, sourceAssetCode);
    } else {
      throw new InvalidFxRateError(
        'Invalid source or asset codes on notifyExpiredFxRate, one must match the peer asset code'
      );
    }
  }
}
