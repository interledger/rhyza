import { LedgerSnapshotEvent, LedgerStateEvent } from './messages/events';
import { ILedger } from './entities/ledger';
import { ILedgerAccount } from './entities/ledger-account';
import { ILedgerTransaction } from './entities/transaction';

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
  storeLedgers(ledgers: ILedger[]): Promise<void>;
  fetchLedgers(ids: string[]): Promise<ILedger[]>;

  storeLedgerAccounts(accounts: ILedgerAccount[]): Promise<void>;
  fetchLedgerAccounts(ids: string[]): Promise<ILedgerAccount[]>;

  storeLedgerTransactions(transactions: ILedgerTransaction[]): Promise<void>;
}
