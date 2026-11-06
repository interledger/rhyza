import type { Session } from 'fastify';
import type { SessionStore } from '@fastify/session';
import { ICache } from 'common-types-lib';

type Callback = (err?: unknown) => void;
type CallbackSession = (err: unknown, result?: Session | null) => void;

const KEY_PREFIX = 'op-auth:session:';

export class CacheSessionStore implements SessionStore {
  constructor(
    private readonly cache: ICache<Session>,
    private readonly ttlMs: number
  ) {}

  set(sessionId: string, session: Session, callback: Callback): void {
    this.cache
      .setWithTtl(`${KEY_PREFIX}${sessionId}`, session, this.ttlMs)
      .then((saved) =>
        callback(saved ? undefined : new Error('Failed to store session'))
      )
      .catch(callback);
  }

  get(sessionId: string, callback: CallbackSession): void {
    this.cache
      .get(`${KEY_PREFIX}${sessionId}`)
      .then((session) => callback(null, session ?? null))
      .catch(callback);
  }

  destroy(sessionId: string, callback: Callback): void {
    this.cache
      .delete(`${KEY_PREFIX}${sessionId}`)
      .then(() => callback())
      .catch(callback);
  }
}
