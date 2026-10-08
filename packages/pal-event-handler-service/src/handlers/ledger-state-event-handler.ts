import {
  ILogger,
  IMessage,
  IMessageConsumer,
  IMessageProducer,
  ITelemetryService,
  MessageTypes,
  StateEvent,
  StateEventTopics,
  TimerEventTopics
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
  LedgerAccountDtoSerializer,
  LedgerSnapshotCheckTimerEvent
} from 'pal-domain-lib';
import { ILedgerDto } from 'pal-public-types-lib';
import { clearInterval } from 'node:timers';

// check every 5 mins
const SNAPSHOT_NEEDED_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export type LedgerStateEventHandlerConfigs = {
  maxStateEventsBetweenSnapshots: number;
  maxTimeBetweenSnapshotsMs: number;
};

/**
 * This handler has two tasks for now:
 * 1. Snapshotter - takes snapshots of the ledger state when needed
 * 2. Projector - updates the read side projections of the ledger state
 *    from the applied event states
 */

export class LedgerStateEventHandler {
  private readonly _logger: ILogger;
  private readonly _configs: LedgerStateEventHandlerConfigs;
  private readonly _esRepo: ILedgerEventSourcingRepository;
  private readonly _aggregate: LedgerAggregate;
  private readonly _uncommittedSnapshots: LedgerSnapshotEvent[];
  private readonly _messageConsumer: IMessageConsumer;
  private readonly _messageProducer: IMessageProducer;
  private readonly _readSideRepo: ILedgerReadSideRepository;
  private readonly _telemetryService: ITelemetryService;

  private readonly _createdLedgers: ILedgerDto[];
  private readonly _changedAccounts: Map<string, ILedgerAccount>;
  private readonly _createdTransactions: ILedgerTransaction[];

  // last state event not yet snapshotted per ledgerId
  private readonly _lastStateEventMap: Map<string, LedgerStateEvent>;
  // last snapshot per ledgerId
  private readonly _lastSnapshotMap: Map<string, LedgerSnapshotEvent>;

  private _checkSnapshotTimer: NodeJS.Timeout | null;
  private _lastSnapshotTakenAt: number | null;

  constructor(
    configs: LedgerStateEventHandlerConfigs,
    esRepo: ILedgerEventSourcingRepository,
    rawMessageConsumer: IMessageConsumer,
    messageProducer: IMessageProducer,
    readSideRepo: ILedgerReadSideRepository,
    logger: ILogger,
    telemetryService: ITelemetryService
  ) {
    this._logger = logger.child(this.constructor.name);
    this._configs = configs;
    this._esRepo = esRepo;
    this._messageConsumer = rawMessageConsumer;
    this._messageProducer = messageProducer;
    this._readSideRepo = readSideRepo;
    this._telemetryService = telemetryService;

    this._createdLedgers = [];
    this._changedAccounts = new Map<string, ILedgerAccount>();
    this._createdLedgers = [];
    this._uncommittedSnapshots = [];
    this._createdTransactions = [];

    this._checkSnapshotTimer = null;
    this._lastSnapshotTakenAt = null;
    this._lastStateEventMap = new Map<string, LedgerStateEvent>();
    this._lastSnapshotMap = new Map<string, LedgerSnapshotEvent>();

    // Instantiate the aggregate to be used by the snapshotter and read side projections
    this._aggregate = new LedgerAggregate(
      this._esRepo,
      this._messageProducer,
      this._logger,
      this._telemetryService
    );
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
    if (stateEvents.length > 0) {
      ledger.applyEvents(stateEvents, true);
    }
    return ledger;
  }

  private _isSnapshotNeeded(ledger: Ledger): boolean {
    // have enough state events been applied?
    if (
      ledger.version >
      ledger.lastSnapshotVersion +
        BigInt(this._configs.maxStateEventsBetweenSnapshots)
    ) {
      return true;
    }

    // has enough time passed?
    const msSinceLastSnapshot = Date.now() - (this._lastSnapshotTakenAt || 0);
    const needed =
      msSinceLastSnapshot >= this._configs.maxTimeBetweenSnapshotsMs;
    return needed;
  }

  private async _snapshotIfNeeded(
    ledger: Ledger,
    lastStateEvent: LedgerStateEvent | undefined
  ): Promise<void> {
    this._logger.debug(
      `Checking if snapshot is needed for ledger ${ledger.id}...`
    );
    if (!this._isSnapshotNeeded(ledger)) {
      this._logger.debug(`Snapshot not needed for ledger ${ledger.id}.`);
      return;
    }

    lastStateEvent = lastStateEvent || this._lastStateEventMap.get(ledger.id);
    if (!lastStateEvent) {
      this._logger.debug(
        `Snapshot not done because no state events were received since last snapshot (or svc start) for ledger ${ledger.id}...`
      );
      return;
    }

    // take snapshot
    const snapshot = ledger.executeSnapshot();

    if (
      lastStateEvent.msgPartition === null ||
      lastStateEvent.msgOffset === null
    ) {
      this._logger.warn(
        `Snapshot failed for ledger: ${ledger.id} v${ledger.version} - could not get lastEvent partition or offset for event msgName: ${lastStateEvent.msgName} and msgId: ${lastStateEvent.msgId}.`
      );
      return;
    }

    // set snapshot lastEvent partition and offset
    snapshot.lastEventIndexPartition = lastStateEvent.msgPartition;
    snapshot.lastEventIndexOffset = lastStateEvent.msgOffset;

    this._uncommittedSnapshots.push(snapshot);
    // remove the last event to avoid snapshotting the same last event
    this._lastStateEventMap.delete(ledger.id);
    this._lastSnapshotMap.set(ledger.id, snapshot);
    this._lastSnapshotTakenAt = snapshot.msgTimestamp;

    this._logger.info(
      `Snapshot created for ledger: ${ledger.id} v${ledger.version}, with lastEventIndexPartition: ${snapshot.lastEventIndexPartition} and lastEventIndexOffset: ${snapshot.lastEventIndexOffset}`
    );
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

  private async _handleMessages(messages: IMessage[]): Promise<void> {
    const startTs = Date.now();
    const stateEventsByLedgerId = new Map<string, LedgerStateEvent[]>();
    const timerSnapshotCheckReqs = new Set<string>();

    // Get state events sorted by ledger id and find timer events
    for (const msg of messages) {
      // find state events
      if (msg.msgType === MessageTypes.STATE_EVENT) {
        const aggregateId = (msg as StateEvent).aggregateId;
        if (!aggregateId) {
          this._logger.warn('Invalid aggregateId in StateEvent');
          continue;
        }

        const aggEvents = stateEventsByLedgerId.get(aggregateId) || [];
        aggEvents.push(msg as LedgerStateEvent);
        stateEventsByLedgerId.set(aggregateId, aggEvents);
      }

      // find timer based snapshot check events
      if (
        msg.msgType === MessageTypes.TIMER &&
        msg.msgName === LedgerSnapshotCheckTimerEvent.name
      ) {
        const aggregateId = (msg as LedgerSnapshotCheckTimerEvent).msgKey;
        if (!aggregateId) {
          this._logger.warn('Invalid msgKey in LedgerSnapshotCheckTimerEvent');
          continue;
        }

        timerSnapshotCheckReqs.add(aggregateId);
      }
    }

    // go through the ledgers and apply events to update the state
    for (const [aggregateId, stateEvents] of stateEventsByLedgerId) {
      const ledger = await this._loadLedgerAndApplyEvents(
        aggregateId,
        stateEvents
      );

      // update last state event for ledger
      const lastEvent = stateEvents[stateEvents.length - 1];
      this._lastStateEventMap.set(aggregateId, lastEvent);

      await this._snapshotIfNeeded(ledger, lastEvent);
      await this._updateReadSideProjections(ledger, stateEvents);
    }

    // go through the snapshot timer-based requests
    for (const aggregateId of timerSnapshotCheckReqs) {
      const ledger = await this._aggregate.getOrLoadLedger(aggregateId, true);
      if (!ledger) {
        continue;
      }

      const wasAlreadySnapshot = this._uncommittedSnapshots.some(
        (evt) => evt.aggregateId === aggregateId
      );
      if (wasAlreadySnapshot) continue;

      const lastNonSnapshotEvent = this._lastStateEventMap.get(aggregateId);
      await this._snapshotIfNeeded(ledger, lastNonSnapshotEvent);
    }

    // persist the read side projections for anything that has changed
    // and publish snapshots if available
    await Promise.all([
      this._persistReadSideProjections(),
      this._publishSnapshots()
    ]);

    this._logger.debug(
      `State event handler completed processing ${messages.length} messages in ${Date.now() - startTs}ms`
    );
  }

  private async _publishSnapshots(): Promise<void> {
    if (this._uncommittedSnapshots.length <= 0) return;

    const startTs = Date.now();
    await this._esRepo.publishSnapshotEvent(this._uncommittedSnapshots);
    this._logger.debug(
      `Published ${this._uncommittedSnapshots.length} snapshots - in ${Date.now() - startTs}ms`
    );
    this._uncommittedSnapshots.length = 0; //reset state
  }

  private async _persistReadSideProjections(): Promise<void> {
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
  }

  async init(): Promise<void> {
    this._messageConsumer.setTopics([
      StateEventTopics.LedgerStateEvents,
      TimerEventTopics.LedgerTimerEvents
    ]);
    this._messageConsumer.setBatchCallbackFn(this._handleMessages.bind(this));
    await this._messageConsumer.connect();
    await this._messageConsumer.startAndWaitForRebalance();

    // use the minimum of the snapshot check interval and the max time between snapshots
    const snapshotCheckIntervalMs = Math.min(
      SNAPSHOT_NEEDED_CHECK_INTERVAL_MS,
      this._configs.maxTimeBetweenSnapshotsMs
    );

    // start the timer that sends timer events
    this._checkSnapshotTimer = setInterval(async () => {
      /*
      Get all ledgers from the read side, we cannot use only what's
      in memory in this instance, as we can have multiple instances
      with other ledgers.
      */
      const ledgerIds = await this._readSideRepo.getAllLedgerIds();
      if (ledgerIds.length <= 0) return;

      const msgs = ledgerIds.map(
        (ledgerId) => new LedgerSnapshotCheckTimerEvent(ledgerId)
      );
      await this._messageProducer.send(msgs);
    }, snapshotCheckIntervalMs);

    this._logger.info(
      `${this.constructor.name} initialized - snapshot check interval is: ${snapshotCheckIntervalMs / 1000} secs`
    );
  }

  async destroy(): Promise<void> {
    if (this._checkSnapshotTimer) {
      clearInterval(this._checkSnapshotTimer);
      this._checkSnapshotTimer = null;
    }

    await this._messageConsumer.stop();
    return;
  }
}
