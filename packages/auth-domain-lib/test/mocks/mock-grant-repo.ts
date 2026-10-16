import {
  IAccessToken,
  IContinuedGrantUpdate,
  IFinishedInteractiveGrantUpdate,
  DEFAULT_SORT_ORDER,
  IGrant,
  IGrantPageOpts,
  IGrantRepository,
  IPage,
  IRevokedGrantUpdate,
  IRotatedGrantUpdate
} from '../../src/grant/interfaces';

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

  /**
   * An approximation, not a reimplementation: enough for the aggregate tests
   * to satisfy the interface. It filters and orders the same way, but it
   * resolves the cursor by scanning rather than seeking an index, does not
   * reject an unknown cursor, and ignores `backwards`. The real keyset
   * behaviour is covered by auth-implementations-lib's integration test.
   */
  async fetchGrantsPage(opts: IGrantPageOpts): Promise<IPage<IGrant>> {
    const descending = (opts.sortOrder ?? DEFAULT_SORT_ORDER) === 'desc';
    const matching = [...this._store.values()]
      .filter((g) => opts.state == null || g.state === opts.state)
      .filter(
        (g) =>
          opts.identifier == null ||
          (g.accesses ?? []).some((a) => a.identifier === opts.identifier)
      )
      .sort((a, b) => {
        const byTime = a.createdAt.getTime() - b.createdAt.getTime();
        const cmp = byTime !== 0 ? byTime : a.id.localeCompare(b.id);
        return descending ? -cmp : cmp;
      });

    const from = opts.cursor
      ? matching.findIndex((g) => g.id === opts.cursor) + 1
      : 0;

    return {
      items: matching.slice(from, from + opts.limit),
      hasNextPage: from + opts.limit < matching.length,
      hasPreviousPage: from > 0
    };
  }

  getAll(): IGrant[] {
    return [...this._store.values()];
  }
}
