import { LedgerSnapshotEvent, LedgerStateEvent } from './messages/events';
import {
  ILedgerAccountDto,
  ILedgerDto,
  ILedgerTransactionDto
} from 'pal-public-types-lib';

/*
repositories
*/
export interface ILedgerEventSourcingRepository {
  // for any events other than snapshot events
  publishEvents(events: LedgerStateEvent[]): Promise<void>;

  // specific for snapshot events
  publishSnapshotEvent(events: LedgerSnapshotEvent[]): Promise<void>;

  fetchLastSnapshot(aggId: string): Promise<LedgerSnapshotEvent | null>;

  fetchStateEvents(
    aggId: string,
    partitionAndOffset?: { partition: number; offset: number }
  ): Promise<LedgerStateEvent[]>;
}

export interface ILedgerReadSideRepository {
  storeLedgers(ledgers: ILedgerDto[]): Promise<void>;
  fetchLedgers(ids: string[]): Promise<ILedgerDto[]>;

  storeLedgerAccounts(accounts: ILedgerAccountDto[]): Promise<void>;
  fetchLedgerAccounts(ids: string[]): Promise<ILedgerAccountDto[]>;

  storeLedgerTransactions(transactions: ILedgerTransactionDto[]): Promise<void>;
}
