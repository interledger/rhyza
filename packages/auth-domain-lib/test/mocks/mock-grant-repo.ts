import {
  IAccessToken,
  IContinuedGrantUpdate,
  IFinishedInteractiveGrantUpdate,
  IGrant,
  IGrantPageOpts,
  IGrantRepository,
  IRevokedGrantUpdate,
  IRotatedGrantUpdate
} from '../../src/grant/interfaces';
import {
  DEFAULT_SORT_ORDER,
  InvalidArgument,
  InvalidCursorError,
  IPage,
  SortOrder
} from 'common-types-lib';

export class MockGrantRepo implements IGrantRepository {
  private _store: Map<string, IGrant> = new Map();

  async storeMany(grants: IGrant[]): Promise<void> {
    for (const grant of grants) {
      this._store.set(grant.id, grant);
    }
  }

  async storeRotatedGrants(updates: IRotatedGrantUpdate[]): Promise<void> {
    for (const update of updates) {
      const grant = this._store.get(update.id);
      if (!grant) continue;
      const tokens = grant.accessTokens.map((t) =>
        t.value === update.revokedToken.value ? update.revokedToken : t
      );
      tokens.push(update.newToken);
      this._store.set(update.id, { ...grant, accessTokens: tokens });
    }
  }

  async storeContinuedGrants(grants: IContinuedGrantUpdate[]): Promise<void> {
    for (const update of grants) {
      const existing = this._store.get(update.id);
      if (!existing) continue;

      const accessTokens = [...existing.accessTokens];
      if (update.accessToken) {
        accessTokens.push(update.accessToken);
      }

      this._store.set(update.id, {
        ...existing,
        state: update.state,
        continueToken: update.continueToken,
        continueId: update.continueId,
        lastContinuedAt: update.lastContinuedAt,
        accessTokens
      });
    }
  }

  async storeFinishedInteractiveGrants(
    grants: IFinishedInteractiveGrantUpdate[]
  ): Promise<void> {
    for (const update of grants) {
      const existing = this._store.get(update.id);
      if (!existing) continue;

      this._store.set(update.id, {
        ...existing,
        state: update.state
      });
    }
  }

  async storeRevokedGrants(grants: IRevokedGrantUpdate[]): Promise<void> {
    for (const update of grants) {
      const existing = this._store.get(update.id);
      if (!existing) continue;

      this._store.set(update.id, {
        ...existing,
        state: update.state,
        continueToken: undefined,
        continueId: undefined
      });
    }
  }

  async storeInteractions(grants: IGrant[]): Promise<void> {
    for (const grant of grants) {
      this._store.set(grant.id, grant);
    }
  }

  async storeRevokedTokens(tokens: IAccessToken[]): Promise<void> {
    for (const token of tokens) {
      for (const [grantId, grant] of this._store) {
        const index = grant.accessTokens.findIndex(
          (t) => t.value === token.value
        );
        if (index === -1) continue;

        const accessTokens = [...grant.accessTokens];
        accessTokens[index] = { ...token };
        this._store.set(grantId, { ...grant, accessTokens });
        break;
      }
    }
  }

  async fetchById(id: string): Promise<IGrant | undefined> {
    return this._store.get(id);
  }

  async fetchByIds(ids: string[]): Promise<IGrant[]> {
    return ids.flatMap((id) => {
      const grant = this._store.get(id);
      return grant ? [grant] : [];
    });
  }

  async fetchGrantsPage(opts: IGrantPageOpts): Promise<IPage<IGrant>> {
    const all = this.getAll();
    const filtered = all
      .filter((g) => opts.state == null || g.state === opts.state)
      .filter(
        (g) =>
          opts.identifier == null ||
          (g.accesses ?? []).some((a) => a.identifier === opts.identifier)
      );
    return this._page(all, filtered, opts);
  }

  // Keyset pagination over (createdAt, id) — mirrors the Mongo implementation.
  // The cursor is resolved against the unfiltered collection, like the
  // Mongo boundary findOne.
  private _page<T extends { id: string; createdAt: Date }>(
    all: T[],
    filtered: T[],
    opts: {
      cursor?: string;
      limit: number;
      backwards: boolean;
      sortOrder?: SortOrder;
    }
  ): IPage<T> {
    if (!Number.isInteger(opts.limit) || opts.limit < 1) {
      throw new InvalidArgument(
        `limit must be a positive integer, got ${opts.limit}`
      );
    }
    const cmp = (a: T, b: T) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

    const descending = (opts.sortOrder ?? DEFAULT_SORT_ORDER) === 'desc';
    // Mirrors the Mongo implementation: paging forward through a descending
    // list walks the (createdAt, id) index towards older documents.
    const scanAscending = opts.backwards === descending;

    let boundary: T | undefined;
    if (opts.cursor != null) {
      boundary = all.find((item) => item.id === opts.cursor);
      if (!boundary) {
        throw new InvalidCursorError(`Unknown cursor: ${opts.cursor}`);
      }
    }

    const inRange = boundary
      ? filtered.filter((item) =>
          scanAscending ? cmp(item, boundary) > 0 : cmp(item, boundary) < 0
        )
      : filtered;

    const sorted = [...inRange].sort(cmp);
    if (!scanAscending) sorted.reverse();

    const hasMore = sorted.length > opts.limit;
    const items = sorted.slice(0, opts.limit);
    if (opts.backwards) items.reverse();

    return {
      items,
      hasNextPage: opts.backwards ? opts.cursor != null : hasMore,
      hasPreviousPage: opts.backwards ? hasMore : opts.cursor != null
    };
  }

  getAll(): IGrant[] {
    return [...this._store.values()];
  }
}
