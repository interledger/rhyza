import {
  CannotCreateDuplicateWalletAddressAliasError,
  CannotCreateDuplicateWalletAddressError,
  WalletAddressAliasNotFoundError,
  WalletAddressAlreadyActiveError,
  WalletAddressAlreadyInactiveError,
  WalletAddressKeyNotFoundError,
  WalletAddressNotFoundError
} from './errors';
import { IPalWalletAddressRepository } from './interfaces';
import { PalWalletAddress } from './entities/wallet-address';
import crypto from 'node:crypto';
import { ILogger } from 'common-types-lib';
import {
  IPalJsonWebKeyDto,
  IPalWalletAddressDto,
  IPalWalletAddressKeyDto,
  WalletAddressAliasCreatedEvent,
  WalletAddressCreatedEvent,
  WalletAddressDomainEvent
} from 'pal-public-types-lib';

export class WalletAddressAggregate {
  private readonly _logger: ILogger;
  private _repo: IPalWalletAddressRepository;
  private readonly _uncommittedDomainEvents: WalletAddressDomainEvent[];

  constructor(repo: IPalWalletAddressRepository, logger: ILogger) {
    this._logger = logger.child(this.constructor.name);
    this._repo = repo;
    this._uncommittedDomainEvents = [];
  }

  get uncommittedDomainEvents(): WalletAddressDomainEvent[] {
    return this._uncommittedDomainEvents;
  }

  clearUncommittedDomainEvents(): void {
    this._uncommittedDomainEvents.length = 0;
  }

  async createWalletAddress(
    domain: string | null,
    pathName: string,
    publicName: string,
    assetCode: string,
    assetScale: number,
    isActive?: boolean
  ): Promise<string> {
    const alias = await this.resolveWalletAddressByAlias(domain, pathName);

    if (alias) {
      this._logger.warn(
        `Wallet Address with that domain and pathName ${domain}/${pathName} already exists`
      );
      throw new CannotCreateDuplicateWalletAddressError(
        `Wallet Address with that domain and pathName ${domain}/${pathName} already exists`
      );
    }

    const newAddressId = crypto.randomUUID();

    const newWallet = new PalWalletAddress(
      newAddressId,
      publicName,
      assetCode,
      assetScale,
      isActive
    );

    newWallet.addAlias(domain, pathName);

    await this._repo.store(newWallet.toDto());

    this._uncommittedDomainEvents.push(
      new WalletAddressCreatedEvent({
        id: newWallet.id,
        domain: domain,
        pathName: pathName,
        assetCode: newWallet.assetCode,
        assetScale: newWallet.assetScale,
        publicName: newWallet.publicName,
        isActive: newWallet.isActive
      })
    );

    return newWallet.id;
  }

  async activate(walletAddressId: string): Promise<void> {
    const [walletDto] = await this._repo.fetch([walletAddressId]);
    if (!walletDto) {
      throw new WalletAddressNotFoundError(
        `Wallet Address with id ${walletAddressId} does not exist`
      );
    }

    const wallet = PalWalletAddress.fromDto(walletDto);
    if (wallet.isActive) {
      throw new WalletAddressAlreadyActiveError(
        `Wallet Address with id ${walletAddressId} is already active`
      );
    }

    wallet.activate();
    this._logger.info(`Wallet address ${walletAddressId} activated`);
    await this._repo.store(wallet.toDto());
  }

  async deactivate(walletAddressId: string): Promise<void> {
    const [walletDto] = await this._repo.fetch([walletAddressId]);
    if (!walletDto) {
      throw new WalletAddressNotFoundError(
        `Wallet Address with id ${walletAddressId} does not exist`
      );
    }

    const wallet = PalWalletAddress.fromDto(walletDto);
    if (!wallet.isActive) {
      throw new WalletAddressAlreadyInactiveError(
        `Wallet Address with id ${walletAddressId} is not active`
      );
    }

    wallet.deactivate();
    this._logger.info(`Wallet address ${walletAddressId} deactivated`);
    await this._repo.store(wallet.toDto());
  }

  async getWalletAddresses(ids: string[]): Promise<IPalWalletAddressDto[]> {
    const found = await this._repo.fetch(ids);

    if (!found || found.length == 0) return [];

    return found.map(PalWalletAddress.fromDto);
  }

  async resolveWalletAddressByAlias(
    domain: string | null,
    pathName: string
  ): Promise<IPalWalletAddressDto | null> {
    const found = await this._repo.getByAlias(domain || null, pathName);

    if (!found) return null;
    return PalWalletAddress.fromDto(found);
  }

  async createWalletAddressAlias(
    domain: string | null,
    pathName: string,
    walletId: string
  ): Promise<void> {
    // ensure the requested alias does not already exist
    const existingAlias = await this._repo.getByAlias(domain, pathName);
    if (existingAlias) {
      throw new CannotCreateDuplicateWalletAddressAliasError(
        'Alias already exists'
      );
    }

    const [walletDto] = await this._repo.fetch([walletId]);
    if (!walletDto) {
      throw new WalletAddressAliasNotFoundError(
        `Wallet Address with id ${walletId} does not exist`
      );
    }

    const wallet = PalWalletAddress.fromDto(walletDto);
    // TODO: validate inputs, especially domain and pathName characters

    wallet.addAlias(domain, pathName);

    await this._repo.store(wallet.toDto());

    this._uncommittedDomainEvents.push(
      new WalletAddressAliasCreatedEvent({
        walletId: wallet.id,
        domain: domain,
        pathName: pathName
      })
    );
  }

  async addWalletAddressKey(
    walletAddressId: string,
    jwk: IPalJsonWebKeyDto
  ): Promise<string> {
    const [walletDto] = await this._repo.fetch([walletAddressId]);
    if (!walletDto) {
      throw new WalletAddressNotFoundError(
        `Wallet Address with id ${walletAddressId} does not exist`
      );
    }

    const wallet = PalWalletAddress.fromDto(walletDto);

    const key = wallet.addKey(jwk);
    await this._repo.storeKey(key.toObject());
    this._logger.info(
      `Stored wallet address key ${key.id} for wallet ${walletAddressId}`
    );
    return key.id;
  }

  async getWalletAddressKeys(
    walletAddressId: string
  ): Promise<IPalWalletAddressKeyDto[]> {
    const [walletDto] = await this._repo.fetch([walletAddressId]);
    if (!walletDto) return [];

    return PalWalletAddress.fromDto(walletDto).keys.map((key) =>
      key.toObject()
    );
  }

  async revokeWalletAddressKey(
    walletAddressId: string,
    keyId: string
  ): Promise<void> {
    const [walletDto] = await this._repo.fetch([walletAddressId]);
    if (!walletDto) {
      throw new WalletAddressKeyNotFoundError(
        `Wallet address key ${keyId} does not exist for wallet ${walletAddressId}`
      );
    }

    const wallet = PalWalletAddress.fromDto(walletDto);
    wallet.revokeKey(keyId);

    const key = wallet.keys.find((stored) => stored.id === keyId);
    if (!key) {
      throw new WalletAddressKeyNotFoundError(
        `Wallet address key ${keyId} does not exist for wallet ${walletAddressId}`
      );
    }

    await this._repo.storeKey(key.toObject());
    this._logger.info(
      `Revoked wallet address key ${keyId} for wallet ${walletAddressId}`
    );
  }
}
