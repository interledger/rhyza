import {
  ILedgerEventSourcingRepository,
  LedgerSnapshotEvent,
  LedgerStateEvent
} from '../../src';
import { IMessage, MessageTypes } from 'common-types-lib';

export class MockLedgerEventSourcingRepository
  implements ILedgerEventSourcingRepository
{
  private _mockMessageStore: IMessage[] = [];

  constructor(mockMessageStore: IMessage[]) {
    this._mockMessageStore = mockMessageStore;
  }

  publishEvents(events: LedgerStateEvent[]): Promise<void> {
    this._mockMessageStore.push(...events);
    return Promise.resolve();
  }
  publishSnapshotEvent(events: LedgerSnapshotEvent[]): Promise<void> {
    this._mockMessageStore.push(...events);
    return Promise.resolve();
  }
  fetchLastSnapshot(aggId: string): Promise<LedgerSnapshotEvent | null> {
    const filtered = this._mockMessageStore.filter(
      (s) => s.msgType === MessageTypes.SNAPSHOT_EVENT && s.msgKey === aggId
    );
    return filtered.length > 0
      ? Promise.resolve(filtered[filtered.length - 1] as LedgerSnapshotEvent)
      : Promise.resolve(null);
  }

  fetchStateEvents(
    aggId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    partitionAndOffset?: { partition: number; offset: number }
  ): Promise<LedgerStateEvent[]> {
    const filtered = this._mockMessageStore.filter(
      (e) => e.msgType === MessageTypes.SNAPSHOT_EVENT && e.msgKey === aggId
    );
    return Promise.resolve(filtered as LedgerStateEvent[]);
  }
}
