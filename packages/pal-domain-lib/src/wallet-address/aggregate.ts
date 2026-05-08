import {
  CannotCreateDuplicateWalletAddressAliasError,
  CannotCreateDuplicateWalletAddressError,
  WalletAddressAliasNotFoundError
} from './errors';
import { IPalWalletAddressRepository } from './interfaces';
import { PalWalletAddress } from './entities/wallet-address';
import crypto from 'node:crypto';
import { ILogger, IMessageProducer } from 'common-types-lib';
import {
  IPalWalletAddressDto,
  WalletAddressAliasCreatedEvent,
  WalletAddressCreatedEvent
} from 'pal-public-types-lib';

export class WalletAddressAggregate {
  private readonly _logger: ILogger;
  private _repo: IPalWalletAddressRepository;
  private readonly _msgProducer: IMessageProducer;

  constructor(
    repo: IPalWalletAddressRepository,
    msgProducer: IMessageProducer,
    logger: ILogger
  ) {
    this._logger = logger;
    this._repo = repo;
    this._msgProducer = msgProducer;
  }

  async createWalletAddress(
    domain: string | null,
    pathName: string,
    publicName: string,
    assetCode: string,
    assetScale: number,
    isActive?: boolean
  ): Promise<string> {
    const alias = await this.resolveWalletAddressAlias(domain, pathName);

    if (alias) {
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

    await this._msgProducer.send(
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

  async getWalletAddresses(ids: string[]): Promise<IPalWalletAddressDto[]> {
    const found = await this._repo.fetch(ids);

    if (!found || found.length == 0) return [];

    return found.map(PalWalletAddress.fromDto);
  }

  async resolveWalletAddressAlias(
    domain: string | null,
    pathName: string
  ): Promise<string | null> {
    const found = await this._repo.getByAlias(domain || null, pathName);

    if (!found) return null;
    return found.id;
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

    await this._msgProducer.send(
      new WalletAddressAliasCreatedEvent({
        walletId: wallet.id,
        domain: domain,
        pathName: pathName
      })
    );
  }
}
