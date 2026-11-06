import { Redis } from 'ioredis';
import { ICache, ILogger } from 'common-types-lib';
import { RedisCache } from 'implementations-lib';
import {
  IPalWalletAddressRepository,
  IPalWalletAddressWithKeysDto
} from 'pal-domain-lib';
import {
  IPalWalletAddressDto,
  IPalWalletAddressKeyDto
} from 'pal-public-types-lib';

const WALLET_KEY_PREFIX = 'pal:wallet:';
const ALIAS_KEY_PREFIX = 'pal:wallet-alias:';
const KEYS_KEY_PREFIX = 'pal:wallet-keys:';

// Redis answers in well under a millisecond, so anything slower means it is
// unhealthy and the read should go to Mongo instead.
const REDIS_COMMAND_TIMEOUT_MS = 1_000;

function walletCacheKey(id: string): string {
  return `${WALLET_KEY_PREFIX}${id}`;
}

// JSON keeps a null domain apart from the string "null", and keeps
// separators inside domain or pathName from running the two together.
function aliasCacheKey(domain: string | null, pathName: string): string {
  return `${ALIAS_KEY_PREFIX}${JSON.stringify([domain, pathName])}`;
}

function keysCacheKey(walletId: string): string {
  return `${KEYS_KEY_PREFIX}${walletId}`;
}

function hasAlias(
  wallet: IPalWalletAddressDto,
  domain: string | null,
  pathName: string
): boolean {
  return wallet.aliases.some(
    (alias) => alias.domain === domain && alias.pathName === pathName
  );
}

function withoutKeys(wallet: IPalWalletAddressDto): IPalWalletAddressDto {
  const copy = { ...wallet };
  delete copy.keys;
  return copy;
}

// Cached values come back from JSON, so revokedAt is a string again.
function reviveKey(key: IPalWalletAddressKeyDto): IPalWalletAddressKeyDto {
  return key.revokedAt ? { ...key, revokedAt: new Date(key.revokedAt) } : key;
}

export interface WalletAddressCaches {
  wallets: ICache<IPalWalletAddressDto>;
  aliases: ICache<string>;
  keys: ICache<IPalWalletAddressKeyDto[]>;
}

// Mongo is the source of truth. Redis caches wallets by id, aliases as a
// pointer to a wallet id, and keys by wallet id. Writes go to Mongo first and
// then evict the entry they changed. Misses are never cached, because
// createWalletAddressAlias relies on getByAlias returning null for a free
// alias. A Redis failure falls back to Mongo and never fails the call; the TTL
// bounds how long a stale entry can live if an eviction is lost.
export class RedisCachedWalletAddressRepo
  implements IPalWalletAddressRepository
{
  private readonly _logger: ILogger;

  constructor(
    private readonly _repo: IPalWalletAddressRepository,
    private readonly _caches: WalletAddressCaches,
    private readonly _ttlMs: number,
    logger: ILogger,
    private readonly _redis?: Redis
  ) {
    this._logger = logger.child(this.constructor.name);
  }

  static async connect(
    repo: IPalWalletAddressRepository,
    redisUrl: string,
    ttlMs: number,
    logger: ILogger
  ): Promise<RedisCachedWalletAddressRepo> {
    const redis = new Redis(redisUrl, {
      lazyConnect: true,
      // Fail commands straight away while disconnected, instead of queueing
      // them until the reconnect attempts run out, so lookups fall back to
      // Mongo during a Redis outage. ioredis keeps reconnecting meanwhile.
      enableOfflineQueue: false,
      commandTimeout: REDIS_COMMAND_TIMEOUT_MS
    });
    redis.on('error', (err: Error) => {
      logger.warn(`Wallet address cache Redis error: ${err.message}`);
    });
    await redis.connect();

    const cacheLogger = logger.child('wallet-address-cache');
    return new RedisCachedWalletAddressRepo(
      repo,
      {
        wallets: new RedisCache(redis, cacheLogger),
        aliases: new RedisCache(redis, cacheLogger),
        keys: new RedisCache(redis, cacheLogger)
      },
      ttlMs,
      logger,
      redis
    );
  }

  async disconnect(): Promise<void> {
    if (this._redis) {
      await this._redis.quit();
    }
  }

  async store(walletAddress: IPalWalletAddressDto): Promise<void> {
    await this._repo.store(walletAddress);
    await this._cacheDelete(
      this._caches.wallets,
      walletCacheKey(walletAddress.id)
    );
  }

  async storeKey(key: IPalWalletAddressKeyDto): Promise<void> {
    await this._repo.storeKey(key);
    await this._cacheDelete(
      this._caches.keys,
      keysCacheKey(key.walletAddressId)
    );
  }

  async fetch(ids: string[]): Promise<IPalWalletAddressDto[]> {
    const uniqueIds = [...new Set(ids)];
    const cached = await Promise.all(
      uniqueIds.map((id) =>
        this._cacheGet(this._caches.wallets, walletCacheKey(id))
      )
    );

    const found = new Map<string, IPalWalletAddressDto>();
    const missingIds: string[] = [];
    uniqueIds.forEach((id, index) => {
      const wallet = cached[index];
      if (wallet) {
        found.set(id, wallet);
      } else {
        missingIds.push(id);
      }
    });

    if (missingIds.length > 0) {
      const loaded = await this._repo.fetch(missingIds);
      await Promise.all(loaded.map((wallet) => this._cacheWallet(wallet)));
      for (const wallet of loaded) {
        found.set(wallet.id, withoutKeys(wallet));
      }
    }

    return uniqueIds
      .map((id) => found.get(id))
      .filter((wallet) => wallet !== undefined);
  }

  async fetchWithKeys(
    id: string
  ): Promise<IPalWalletAddressWithKeysDto | null> {
    const cachedKeys = await this._cacheGet(
      this._caches.keys,
      keysCacheKey(id)
    );

    if (cachedKeys) {
      const [wallet] = await this.fetch([id]);
      if (!wallet) {
        return null;
      }
      return { ...wallet, keys: cachedKeys.map(reviveKey) };
    }

    const loaded = await this._repo.fetchWithKeys(id);
    if (!loaded) {
      return null;
    }

    await Promise.all([
      this._cacheWallet(loaded),
      this._cacheSet(this._caches.keys, keysCacheKey(id), loaded.keys)
    ]);
    return loaded;
  }

  async getByAlias(
    domain: string | null,
    pathName: string
  ): Promise<IPalWalletAddressDto | null> {
    const aliasKey = aliasCacheKey(domain, pathName);
    const walletId = await this._cacheGet(this._caches.aliases, aliasKey);

    if (walletId) {
      const [wallet] = await this.fetch([walletId]);
      if (wallet && hasAlias(wallet, domain, pathName)) {
        return wallet;
      }
      // The mapping points at a wallet that no longer has this alias.
      await this._cacheDelete(this._caches.aliases, aliasKey);
    }

    const wallet = await this._repo.getByAlias(domain, pathName);
    if (!wallet) {
      return null;
    }

    await Promise.all([
      this._cacheSet(this._caches.aliases, aliasKey, wallet.id),
      this._cacheWallet(wallet)
    ]);
    return withoutKeys(wallet);
  }

  private _cacheWallet(wallet: IPalWalletAddressDto): Promise<void> {
    return this._cacheSet(
      this._caches.wallets,
      walletCacheKey(wallet.id),
      withoutKeys(wallet)
    );
  }

  private async _cacheGet<T>(
    cache: ICache<T>,
    key: string
  ): Promise<T | undefined> {
    try {
      return await cache.get(key);
    } catch (err) {
      this._logger.warn(
        `Wallet address cache get failed for ${key}; reading Mongo. ${(err as Error).message}`
      );
      return undefined;
    }
  }

  private async _cacheSet<T>(
    cache: ICache<T>,
    key: string,
    value: T
  ): Promise<void> {
    try {
      await cache.setWithTtl(key, value, this._ttlMs);
    } catch (err) {
      this._logger.warn(
        `Wallet address cache set failed for ${key}. ${(err as Error).message}`
      );
    }
  }

  private async _cacheDelete<T>(cache: ICache<T>, key: string): Promise<void> {
    try {
      await cache.delete(key);
    } catch (err) {
      this._logger.warn(
        `Wallet address cache evict failed for ${key}; it may serve a stale entry until its TTL expires. ${(err as Error).message}`
      );
    }
  }
}
