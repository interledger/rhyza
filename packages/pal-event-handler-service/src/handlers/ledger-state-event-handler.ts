import {
  ILogger,
  IMessage,
  IMessageConsumer,
  MessageTypes,
  StateEvent,
  StateEventTopics
} from 'common-types-lib';
import {
  ILedgerAccount,
  ILedgerEventSourcingRepository,
  ILedgerTransaction,
  Ledger,
  LedgerAggregate,
  LedgerSnapshotEvent,
  LedgerStateEvent,
  LedgerTransactionDtoSerializer,
  LedgerTransactionRecordedStateEvent,
  ILedgerReadSideRepository,
  LedgerAccountsCreatedStateEvent,
  LedgerAccountDtoSerializer
} from 'pal-domain-lib';
import { ILedgerDto } from 'pal-public-types-lib';

export type LedgerStateEventHandlerConfigs = {
  maxStateEventsBetweenSnapshots: number;
  maxTimeBetweenSnapshotsMs: number;
  minTimeBetweenSnapshotsMs: number;
};

/**
 * This handler has two tasks for now:
 * 1. Snapshotter - takes snapshots of the ledger state when needed
 * 2. Projector - updates the read side projections of the ledger state
 */

export class LedgerStateEventHandler {
  private readonly _logger: ILogger;
  private readonly _configs: LedgerStateEventHandlerConfigs;
  private readonly _esRepo: ILedgerEventSourcingRepository;
  private readonly _aggregate: LedgerAggregate;
  private readonly _uncommittedSnapshots: LedgerSnapshotEvent[];
  private readonly _messageConsumer: IMessageConsumer;
  private readonly _readSideRepo: ILedgerReadSideRepository;

  private readonly _createdLedgers: ILedgerDto[] = [];
  private readonly _changedAccounts: Map<string, ILedgerAccount> = new Map<
    string,
    ILedgerAccount
  >();
  private readonly _createdTransactions: ILedgerTransaction[] = [];

  constructor(
    configs: LedgerStateEventHandlerConfigs,
    aggregate: LedgerAggregate,
    esRepo: ILedgerEventSourcingRepository,
    rawMessageConsumer: IMessageConsumer,
    readSideRepo: ILedgerReadSideRepository,
    logger: ILogger
  ) {
    this._logger = logger;
    this._configs = configs;
    this._esRepo = esRepo;
    this._messageConsumer = rawMessageConsumer;
    this._readSideRepo = readSideRepo;
    this._aggregate = aggregate;
    this._uncommittedSnapshots = [];
  }

  private async _loadLedgerAndApplyEvents(
    ledgerId: string,
    stateEvents: LedgerStateEvent[]
  ): Promise<Ledger> {
    const ledger = await this._aggregate.getOrLoadLedger(ledgerId, true);
    if (!ledger) {
      throw new Error('Ledger with aggregateId not found');
    }

    // load state events, already loaded evts/versions will be ignored
    ledger.applyEvents(stateEvents, true);
    return ledger;
  }

  private async _snapshotIfNeeded(
    ledger: Ledger,
    stateEvents: LedgerStateEvent[]
  ) {
    // do we need to take a snapshot now?
    if (
      ledger.version <=
      ledger.lastSnapshotVersion +
        BigInt(this._configs.maxStateEventsBetweenSnapshots)
    ) {
      return;
    }

    const lastEvent = stateEvents[stateEvents.length - 1];
    let lastEventIndex: { partition: number; offset: number } | undefined =
      undefined;
    if (lastEvent.msgPartition != null && lastEvent.msgOffset != null) {
      lastEventIndex = {
        partition: lastEvent.msgPartition,
        offset: lastEvent.msgOffset
      };
    }

    const snapshot = ledger.executeSnapshot();
    if (lastEventIndex) {
      snapshot.lastEventIndexPartition = lastEventIndex.partition;
      snapshot.lastEventIndexOffset = lastEventIndex.offset;
    }
    this._uncommittedSnapshots.push(snapshot);
  }

  private async _updateReadSideProjections(
    ledger: Ledger,
    stateEvents: LedgerStateEvent[]
  ) {
    if (!this._createdLedgers.find((l) => l.id === ledger.id)) {
      this._createdLedgers.push(ledger.toDTO());
    }

    const transactions: ILedgerTransaction[] = stateEvents
      .filter((e) => e.msgName === LedgerTransactionRecordedStateEvent.name)
      .map((e: LedgerTransactionRecordedStateEvent) => {
        return LedgerTransactionDtoSerializer.fromDTO(e.payload.transaction);
      });
    this._createdTransactions.push(...transactions);

    // find affected accounts and add them to the list of changed accounts
    // starting with created accounts
    const createAccsEvents = stateEvents.filter(
      (e) => e.msgName === LedgerAccountsCreatedStateEvent.name
    );
    const changedAccountIds: string[] = createAccsEvents.flatMap(
      (stateEvt: LedgerAccountsCreatedStateEvent) =>
        stateEvt.payload.accounts.map((item) => item.id)
    );

    transactions.forEach((tx) => {
      changedAccountIds.push(...[tx.debitedAccountId, tx.creditedAccountId]);
    });

    const changedAccounts = ledger.getAccounts(changedAccountIds);
    changedAccounts.forEach((account) => {
      this._changedAccounts.set(account.id, account);
    });
  }

  private async _handleStateMessages(messages: IMessage[]): Promise<void> {
    const startTs = Date.now();
    const stateEventMap = new Map<string, LedgerStateEvent[]>();

    // filter out unwanted msgs and sort by ledger id
    for (const msg of messages) {
      if (msg.msgType !== MessageTypes.STATE_EVENT) {
        this._logger.warn('Invalid message type is not StateEvent');
        continue;
      }
      const aggregateId = (msg as StateEvent).aggregateId;
      if (!aggregateId) {
        this._logger.warn('Invalid aggregateId in StateEvent');
        continue;
      }

      const aggEvents = stateEventMap.get(aggregateId) || [];
      aggEvents.push(msg as LedgerStateEvent);
      stateEventMap.set(aggregateId, aggEvents);
    }

    // go through ledger and apply events
    for (const [aggregateId, stateEvents] of stateEventMap) {
      const ledger = await this._loadLedgerAndApplyEvents(
        aggregateId,
        stateEvents
      );
      await this._snapshotIfNeeded(ledger, stateEvents);
      await this._updateReadSideProjections(ledger, stateEvents);
    }

    // publish snapshots if available
    if (this._uncommittedSnapshots.length > 0) {
      await this._esRepo.publishSnapshotEvent(this._uncommittedSnapshots);
      this._logger.debug(
        `Received ${messages.length} state events, created ${this._uncommittedSnapshots.length} snapshots - in ${Date.now() - startTs}ms`
      );
      this._uncommittedSnapshots.length = 0; //reset state
    }

    // persist the read side projections for anything that has changed
    if (this._createdLedgers.length > 0) {
      await this._readSideRepo.storeLedgers(this._createdLedgers);
      this._logger.debug(
        `Updated read side projections for ${this._createdLedgers.length} ledgers`
      );
      this._createdLedgers.length = 0;
    }

    if (this._changedAccounts.size) {
      await this._readSideRepo.storeLedgerAccounts(
        Array.from(this._changedAccounts.values()).map(
          LedgerAccountDtoSerializer.toDTO
        )
      );
      this._logger.debug(
        `Updated read side projections for ${this._changedAccounts.size} accounts`
      );
      this._changedAccounts.clear();
    }
    if (this._createdTransactions.length > 0) {
      await this._readSideRepo.storeLedgerTransactions(
        this._createdTransactions.map(LedgerTransactionDtoSerializer.toDTO)
      );
      this._logger.debug(
        `Updated read side projections for ${this._createdTransactions.length} transactions`
      );
      this._createdTransactions.length = 0;
    }

    this._logger.debug(
      `State event handler completed processing ${messages.length} messages in ${Date.now() - startTs}ms`
    );
  }

  async init(): Promise<void> {
    this._messageConsumer.setTopics([StateEventTopics.LedgerStateEvents]);
    this._messageConsumer.setBatchCallbackFn(
      this._handleStateMessages.bind(this)
    );
    await this._messageConsumer.connect();
    await this._messageConsumer.startAndWaitForRebalance();

    this._logger.info(`${this.constructor.name} initialized`);
  }

  async destroy(): Promise<void> {
    await this._messageConsumer.stop();
    return;
  }
}
