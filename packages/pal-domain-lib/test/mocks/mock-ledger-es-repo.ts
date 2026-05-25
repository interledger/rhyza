import {
  ILedgerEventSourcingRepository,
  LedgerSnapshotEvent,
  LedgerStateEvent
} from '../../src';

export class MockLedgerEventSourcingRepository
  implements ILedgerEventSourcingRepository
{
  private _events: LedgerStateEvent[] = [];
  private _snapshots: LedgerSnapshotEvent[] = [];

  publishEvents(events: LedgerStateEvent[]): Promise<void> {
    this._events.push(...events);
    return Promise.resolve();
  }
  publishSnapshotEvent(events: LedgerSnapshotEvent[]): Promise<void> {
    this._snapshots.push(...events);
    return Promise.resolve();
  }
  fetchLastSnapshot(aggId: string): Promise<LedgerSnapshotEvent | null> {
    const filtered = this._snapshots.filter((s) => s.aggregateId === aggId);
    return filtered.length > 0
      ? Promise.resolve(filtered[filtered.length - 1])
      : Promise.resolve(null);
  }

  fetchStateEvents(
    aggId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    partitionAndOffset?: { partition: number; offset: number }
  ): Promise<LedgerStateEvent[]> {
    const filtered = this._events.filter((e) => e.aggregateId === aggId);
    return Promise.resolve(filtered);
  }
}
