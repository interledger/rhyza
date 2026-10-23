import {
  IAccessToken,
  IContinuedGrantUpdate,
  IFinishedInteractiveGrantUpdate,
  IGrant,
  IGrantRepository,
  IRevokedGrantUpdate,
  IRotatedGrantUpdate,
  IUpdatedSpentAmountGrant
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

  async storeUpdatedSpentAmountGrants(
    grants: IUpdatedSpentAmountGrant[]
  ): Promise<void> {
    for (const update of grants) {
      const existing = this._store.get(update.id);
      if (!existing) continue;

      this._store.set(update.id, {
        ...existing,
        spentAmounts: update.spentAmounts
      });
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

  getAll(): IGrant[] {
    return [...this._store.values()];
  }
}
