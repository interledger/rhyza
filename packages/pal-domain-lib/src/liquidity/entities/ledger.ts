import { ILedgerAccount, LedgerAccountDtoSerializer } from './ledger-account';
import {
  LedgerAccountsCreatedStateEvent,
  LedgerCreatedStateEvent,
  LedgerSnapshotEvent,
  LedgerStateEvent,
  LedgerTransactionRecordedStateEvent
} from '../messages/events';
import {
  CheckBalanceAndReserveTransferCmd,
  CommitTransferCmd,
  CreateLedgerAccountForAssetCmd,
  CreateLedgerAccountsForPeerCmd,
  LedgerCommand,
  PostTransactionCmd,
  RejectTransferCmd,
  ReserveTransferCmd
} from '../messages/commands';
import { ILogger, MessageTypes } from 'common-types-lib';
import {
  LedgerDomainEvent,
  LedgerTransactionPostedEvent,
  LedgerOutgoingTransferCommittedEvent,
  LedgerOutgoingTransferRejectedEvent,
  LedgerOutgoingTransferReservedEvent,
  LedgerOutgoingTransferInsufficientFundsErrorEvent,
  LedgerAccountNotFoundEvent,
  ILedgerTransactionDto,
  LedgerAccountCreatedForAssetEvent,
  LedgerAccountCreationForAssetFailedEvent,
  LedgerAccountCreationForPeerFailedEvent,
  LedgerAccountsCreatedForPeerEvent,
  ILedgerDto,
  LedgerIncomingTransferReservedEvent,
  LedgerIncomingTransferCommittedEvent,
  LedgerIncomingTransferRejectedEvent,
  LedgerIncomingTransferInsufficientFundsErrorEvent
} from 'pal-public-types-lib';

const DEFAULT_DISPLAY_ASSET_SCALE = 2;

export class Ledger {
  private readonly _id: string; // ledger id is the asset code
  private readonly _logger: ILogger;
  private _version: bigint;
  private _assetScale: number;
  private _accounts: ILedgerAccount[];
  private _transactionCount: bigint;
  private _lastSnapshotVersion: bigint;

  private readonly _uncommittedStateEvents: LedgerStateEvent[];
  private readonly _uncommittedDomainEvents: LedgerDomainEvent[];

  private constructor(id: string, assetScale: number, logger: ILogger) {
    this._logger = logger;
    this._version = 0n; // we start at version 1 because there is already the LedgerCreatedStateEvent
    this._lastSnapshotVersion = 0n;
    this._accounts = [];
    this._uncommittedStateEvents = [];
    this._uncommittedDomainEvents = [];
    this._transactionCount = 0n;

    this._id = id;
    this._assetScale = assetScale;
    // this._esRepo = esRepo;
  }

  /**
   * Create a new ledger with the given id and asset scale, should be called only
   * as consequence of the CreateLedgerCmd command
   * @param id
   * @param assetScale
   * @param logger
   * @constructor
   */
  static CreateNewLedger(
    id: string,
    assetScale: number,
    logger: ILogger
  ): Ledger {
    const ledger = new Ledger(id, assetScale, logger);
    ledger._version = 1n;
    return ledger;
  }

  /**
   * Create a new ledger with the given id and asset scale, to be loaded from events
   * @param id
   * @param logger
   * @constructor
   */
  static GetUnloadedLedger(id: string, logger: ILogger): Ledger {
    const ledger = new Ledger(id, 0, logger);
    ledger._version = 0n;
    return ledger;
  }

  /*
   * getters
   * */

  get id(): string {
    return this._id;
  }

  get version(): bigint {
    return this._version;
  }

  get assetScale(): number {
    return this._assetScale;
  }

  get lastSnapshotVersion(): bigint {
    return this._lastSnapshotVersion;
  }

  get uncommittedStateEvents(): LedgerStateEvent[] {
    return this._uncommittedStateEvents;
  }

  get uncommittedDomainEvents(): LedgerDomainEvent[] {
    return this._uncommittedDomainEvents;
  }

  get accountsCount(): number {
    return this._accounts.length;
  }

  get transactionsCount(): bigint {
    return this._transactionCount;
  }

  /*
   * private
   * */

  private _recordAndApplyStateEvent(event: LedgerStateEvent): void {
    // event version must be resulting agg version (after evt apply
    event.aggregateVersion = (this._version + 1n).toString();
    this._uncommittedStateEvents.push(event);
    this._applyEvent(event);
  }

  private _recordDomainEvent(
    event: LedgerDomainEvent,
    requestId?: string
  ): void {
    if (requestId) {
      event.requestId = requestId;
    }
    this._uncommittedDomainEvents.push(event);
  }

  /*
   * Apply events and snapshot
   * */

  private _applySnapshot(snapshot: LedgerSnapshotEvent): void {
    if (
      snapshot.msgType !== MessageTypes.SNAPSHOT_EVENT ||
      snapshot.msgName !== LedgerSnapshotEvent.name
    ) {
      throw new Error('Invalid snapshot event type');
    }

    /*
    Note: when applying snapshots, we don't care about applying the immediately
    next version event, but we do care about leaving the state in the correct version
    after the snapshot is applied.
    */

    // We can only apply a snapshot that is posterior to the current state
    if (this._version >= BigInt(snapshot.aggregateVersion)) {
      throw new Error(
        'Version mismatch - cannot apply snapshot with version that is older than current state version'
      );
    }

    this._accounts = snapshot.payload.accounts.map(
      LedgerAccountDtoSerializer.fromDTO
    );
    this._lastSnapshotVersion = this._version = BigInt(
      snapshot.aggregateVersion
    );
    this._transactionCount = BigInt(snapshot.payload.transactionCount);

    this._logger.debug(
      `Ledger ${this.id} - loaded from snapshot at version: ${this.version}, accounts count: ${this.accountsCount}, transactions count: ${this.transactionsCount}`
    );
  }

  private _applyEvent(
    event: LedgerStateEvent,
    replayed: boolean = false
  ): void {
    if (event.msgType !== MessageTypes.STATE_EVENT)
      throw new Error('Invalid event type');

    if (BigInt(event.aggregateVersion) !== this._version + 1n) {
      if (replayed) return; // ignore older events if replaying
      throw new Error(
        'Event version mismatch, cannot apply event out of order'
      );
    }

    if (LedgerStateEvent.isLedgerCreatedStateEvent(event)) {
      this._applyLedgerCreatedStateEvent(event);
    } else if (LedgerStateEvent.isLedgerAccountsCreatedStateEvent(event)) {
      this._applyLedgerAccountsCreatedStateEvent(event);
    } else if (LedgerStateEvent.isLedgerTransactionRecordedStateEvent(event)) {
      this._applyLedgerTransactionRecordedStateEvent(event);
    } else {
      throw new Error('Invalid event type');
    }

    // aggregate version to event
    this._version = BigInt(event.aggregateVersion);
  }

  private _applyLedgerCreatedStateEvent(event: LedgerCreatedStateEvent): void {
    this._assetScale = event.payload.assetScale;
  }

  private _applyLedgerAccountsCreatedStateEvent(
    event: LedgerAccountsCreatedStateEvent
  ): void {
    const duplicateFound = event.payload.accounts.some((newAccount) => {
      this._accounts.some((acc) => acc.id === newAccount.id);
    });
    if (duplicateFound) {
      throw new Error(
        'Account with that ID already exists, cannot apply event'
      );
    }
    this._accounts.push(
      ...event.payload.accounts.map(LedgerAccountDtoSerializer.fromDTO)
    );
  }

  private _applyLedgerTransactionRecordedStateEvent(
    event: LedgerTransactionRecordedStateEvent
  ): void {
    const drAccount = this._accounts.find(
      (a) => a.id === event.payload.transaction.debitedAccountId
    );
    const crAccount = this._accounts.find(
      (a) => a.id === event.payload.transaction.creditedAccountId
    );
    if (!drAccount || !crAccount) {
      throw new Error('Accounts not found');
    }
    const amount = BigInt(event.payload.transaction.amount);
    drAccount.debitedAmount += amount;
    crAccount.creditedAmount += amount;

    this._transactionCount++;
  }

  /*
   * process commands
   * */

  private async _processCreateLedgerAccountForAssetCmd(
    cmd: CreateLedgerAccountForAssetCmd
  ): Promise<void> {
    if (cmd.payload.assetCode !== this._id) {
      this._recordDomainEvent(
        new LedgerAccountCreationForAssetFailedEvent({
          assetCode: cmd.payload.assetCode,
          reason: 'ASSET_CODE_MISMATCH'
        }),
        cmd.requestId
      );
      this._logger.warn(
        `Asset code: ${cmd.payload.assetCode} of new account with ID: ${cmd.payload.id} does not match ledger's ID: ${this._id}`
      );
      return;
    }

    const existingAccount = this._accounts.find((a) => a.id === cmd.payload.id);
    if (existingAccount) {
      this._recordDomainEvent(
        new LedgerAccountCreationForAssetFailedEvent({
          assetCode: cmd.payload.assetCode,
          reason: 'DUPLICATE_ACCOUNT_ID'
        }),
        cmd.requestId
      );
      this._logger.warn(
        `Account with ID: ${cmd.payload.id} already exists in ledger: ${this._id}`
      );
      return;
    }

    this._recordAndApplyStateEvent(
      new LedgerAccountsCreatedStateEvent(this._id, {
        accounts: [
          {
            id: cmd.payload.id,
            name: `Asset Account for '${cmd.payload.assetCode}'`,
            assetCode: cmd.payload.assetCode,
            assetDisplayScale: DEFAULT_DISPLAY_ASSET_SCALE,
            externalId: cmd.payload.assetCode,
            debitedAmount: 0n.toString(),
            creditedAmount: 0n.toString()
          }
        ]
      })
    );

    this._recordDomainEvent(
      new LedgerAccountCreatedForAssetEvent(this._id, {
        id: cmd.payload.id,
        assetCode: cmd.payload.assetCode
      }),
      cmd.requestId
    );
  }

  private async _processCreateLedgerAccountsForPeerCmd(
    cmd: CreateLedgerAccountsForPeerCmd
  ): Promise<void> {
    if (cmd.payload.assetCode !== this._id) {
      this._recordDomainEvent(
        new LedgerAccountCreationForPeerFailedEvent({
          peerId: cmd.payload.peerId,
          assetCode: cmd.payload.assetCode,
          reason: 'ASSET_CODE_MISMATCH'
        }),
        cmd.requestId
      );
      this._logger.warn(
        `Asset code: ${cmd.payload.assetCode} of account creation comand for peer: ${cmd.payload.peerId} does not match ledger's ID: ${this._id}`
      );
      return;
    }

    const duplicateIdFound = this._accounts.some(
      (acc) =>
        acc.id === cmd.payload.peerLiquidityAccId ||
        acc.id === cmd.payload.peerClearingAccId ||
        acc.id === cmd.payload.aseLiquidityAccId ||
        acc.id === cmd.payload.aseClearingAccId ||
        acc.id === cmd.payload.suspenseAccId
    );

    if (duplicateIdFound) {
      this._recordDomainEvent(
        new LedgerAccountCreationForPeerFailedEvent({
          peerId: cmd.payload.peerId,
          assetCode: cmd.payload.assetCode,
          reason: 'DUPLICATE_ACCOUNT_ID'
        }),
        cmd.requestId
      );
      this._logger.warn(
        `Duplicate account id detected while processing CreateLedgerAccountsForPeerCmd for peerId: ${cmd.payload.peerId}`
      );
      return;
    }

    const commonStateEventObj = {
      assetCode: cmd.payload.assetCode,
      assetDisplayScale: DEFAULT_DISPLAY_ASSET_SCALE,
      externalId: cmd.payload.peerId,
      debitedAmount: 0n.toString(),
      creditedAmount: 0n.toString()
    };

    this._recordAndApplyStateEvent(
      new LedgerAccountsCreatedStateEvent(this._id, {
        accounts: [
          {
            id: cmd.payload.peerLiquidityAccId,
            name: `Peer Liquidity Account for peer '${cmd.payload.peerId}'`,
            ...commonStateEventObj
          },
          {
            id: cmd.payload.peerClearingAccId,
            name: `Peer Clearing Account for peer '${cmd.payload.peerId}'`,
            ...commonStateEventObj
          },
          {
            id: cmd.payload.aseLiquidityAccId,
            name: `ASE Liquidity Account for peer '${cmd.payload.peerId}'`,
            ...commonStateEventObj
          },
          {
            id: cmd.payload.aseClearingAccId,
            name: `ASE Clearing Account for peer '${cmd.payload.peerId}'`,
            ...commonStateEventObj
          },
          {
            id: cmd.payload.suspenseAccId,
            name: `Peer Suspense Account for peer '${cmd.payload.peerId}'`,
            ...commonStateEventObj
          }
        ]
      })
    );

    const outputDomainEvent = new LedgerAccountsCreatedForPeerEvent(this._id, {
      peerId: cmd.payload.peerId,
      assetCode: cmd.payload.assetCode,
      peerLiquidityAccId: cmd.payload.peerLiquidityAccId,
      peerClearingAccId: cmd.payload.peerClearingAccId,
      aseLiquidityAccId: cmd.payload.aseLiquidityAccId,
      aseClearingAccId: cmd.payload.aseClearingAccId,
      suspenseAccId: cmd.payload.suspenseAccId
    });

    this._recordDomainEvent(outputDomainEvent, cmd.requestId);
  }

  private async _processPostTransactionCmd(
    cmd: PostTransactionCmd
  ): Promise<void> {
    const debitedAccount: ILedgerAccount | undefined = this._accounts.find(
      (a) => a.id === cmd.payload.debitedAccountId
    );
    const creditedAccount = this._accounts.find(
      (a) => a.id === cmd.payload.creditedAccountId
    );
    if (!debitedAccount || !creditedAccount) {
      throw new Error('Account(s) not found');
    }
    // note: we don't need to check that the accounts are of the same asset in the same ledger!

    // TODO validate amount and convert to ledger scale

    const transactionDTO: ILedgerTransactionDto = {
      id: cmd.payload.id,
      debitedAccountId: cmd.payload.debitedAccountId,
      creditedAccountId: cmd.payload.creditedAccountId,
      amount: cmd.payload.amount,
      amountScale: cmd.payload.amountScale,
      timestamp: Date.now(),
      externalId: cmd.payload.transferId
    };

    this._recordAndApplyStateEvent(
      new LedgerTransactionRecordedStateEvent(this._id, {
        transaction: transactionDTO
      })
    );

    this._recordDomainEvent(
      new LedgerTransactionPostedEvent(this._id, transactionDTO),
      cmd.requestId
    );
  }

  private async _processReserveTransferCmd(
    cmd: ReserveTransferCmd
  ): Promise<void> {
    const payerClearingAccount: ILedgerAccount | undefined =
      this._accounts.find((a) => a.id === cmd.payload.payerClearingAccountId);
    const suspenseAccount = this._accounts.find(
      (a) => a.id === cmd.payload.suspenseAccountId
    );
    if (!payerClearingAccount || !suspenseAccount) {
      this._recordDomainEvent(
        new LedgerAccountNotFoundEvent({
          assetCode: this._id,
          accountId: cmd.payload.payerClearingAccountId
        }),
        cmd.requestId
      );
      this._logger.warn(
        'Account(s) not found in CheckBalanceAndReserveTransferCmd'
      );
      return;
    }
    // note: we don't need to check that the accounts are of the same asset in the same ledger!

    // TODO validate amount and convert to ledger scale
    const transactionDTO: ILedgerTransactionDto = {
      id: crypto.randomUUID(),
      debitedAccountId: cmd.payload.payerClearingAccountId,
      creditedAccountId: cmd.payload.suspenseAccountId,
      amount: cmd.payload.amount,
      amountScale: cmd.payload.amountScale,
      timestamp: Date.now(),
      externalId: cmd.payload.transferId
    };

    this._recordAndApplyStateEvent(
      new LedgerTransactionRecordedStateEvent(this._id, {
        transaction: transactionDTO
      })
    );

    if (cmd.payload.transferDirection === 'OUTGOING') {
      this._recordDomainEvent(
        new LedgerOutgoingTransferReservedEvent(this._id, {
          requestId: cmd.payload.requestId,
          transferId: cmd.payload.transferId,
          isError: false
        }),
        cmd.requestId
      );
    } else {
      this._recordDomainEvent(
        new LedgerIncomingTransferReservedEvent(this._id, {
          requestId: cmd.payload.requestId,
          transferId: cmd.payload.transferId,
          isError: false
        }),
        cmd.requestId
      );
    }
  }

  private async _processCheckBalanceAndReserveCmd(
    cmd: CheckBalanceAndReserveTransferCmd
  ): Promise<void> {
    const payerClearingAccount: ILedgerAccount | undefined =
      this._accounts.find((a) => a.id === cmd.payload.payerClearingAccountId);
    const payerLiquidityAccount = this._accounts.find(
      (a) => a.id === cmd.payload.payerLiquidityAccountId
    );
    const suspenseAccount = this._accounts.find(
      (a) => a.id === cmd.payload.suspenseAccountId
    );
    if (!payerClearingAccount || !payerLiquidityAccount || !suspenseAccount) {
      this._recordDomainEvent(
        new LedgerAccountNotFoundEvent({
          assetCode: this._id,
          accountId: cmd.payload.payerClearingAccountId
        }),
        cmd.requestId
      );
      this._logger.warn(
        'Account(s) not found in CheckBalanceAndReserveTransferCmd'
      );
      return;
    }
    // note: we don't need to check that the accounts are of the same asset in the same ledger!

    const amount = BigInt(cmd.payload.amount);

    // check liquidity
    const clearingBalance =
      payerClearingAccount.creditedAmount - payerClearingAccount.debitedAmount;
    const liquidityBalance =
      payerLiquidityAccount.creditedAmount -
      payerLiquidityAccount.debitedAmount;
    const hasLiquidity = clearingBalance + liquidityBalance >= amount;

    if (!hasLiquidity) {
      this._logger.warn(
        `Ledger ${this._id} - check balance and reserve transfer failed, insufficient liquidity`
      );
      if (cmd.payload.transferDirection === 'OUTGOING') {
        this._uncommittedDomainEvents.push(
          new LedgerOutgoingTransferInsufficientFundsErrorEvent(
            this._id,
            cmd.payload.requestId,
            cmd.payload.transferId
          )
        );
      } else {
        this._uncommittedDomainEvents.push(
          new LedgerIncomingTransferInsufficientFundsErrorEvent(
            this._id,
            cmd.payload.requestId,
            cmd.payload.transferId
          )
        );
      }
      return;
    }

    // TODO validate amount and convert to ledger scale

    const transactionDTO: ILedgerTransactionDto = {
      id: crypto.randomUUID(),
      debitedAccountId: cmd.payload.payerClearingAccountId,
      creditedAccountId: cmd.payload.suspenseAccountId,
      amount: amount.toString(),
      amountScale: cmd.payload.amountScale,
      timestamp: Date.now(),
      externalId: cmd.payload.transferId
    };

    this._recordAndApplyStateEvent(
      new LedgerTransactionRecordedStateEvent(this._id, {
        transaction: transactionDTO
      })
    );

    if (cmd.payload.transferDirection === 'OUTGOING') {
      this._recordDomainEvent(
        new LedgerOutgoingTransferReservedEvent(this._id, {
          requestId: cmd.payload.requestId,
          transferId: cmd.payload.transferId,
          isError: false
        }),
        cmd.requestId
      );
    } else {
      this._recordDomainEvent(
        new LedgerIncomingTransferReservedEvent(this._id, {
          requestId: cmd.payload.requestId,
          transferId: cmd.payload.transferId,
          isError: false
        }),
        cmd.requestId
      );
    }
  }

  private async _processCommitTransferCmd(
    cmd: CommitTransferCmd
  ): Promise<void> {
    const suspenseAccount = this._accounts.find(
      (a) => a.id === cmd.payload.suspenseAccountId
    );
    const payerClearingAccount: ILedgerAccount | undefined =
      this._accounts.find((a) => a.id === cmd.payload.payerClearingAccountId);
    const payeeClearingAccount = this._accounts.find(
      (a) => a.id === cmd.payload.payeeClearingAccountId
    );
    if (!payerClearingAccount || !payeeClearingAccount || !suspenseAccount) {
      this._recordDomainEvent(
        new LedgerAccountNotFoundEvent({
          assetCode: this._id,
          accountId: cmd.payload.payerClearingAccountId
        }),
        cmd.requestId
      );
      this._logger.warn('Account(s) not found in CommitTransferCmd');
      return;
    }

    const now = Date.now();

    this._recordAndApplyStateEvent(
      new LedgerTransactionRecordedStateEvent(this._id, {
        transaction: {
          id: crypto.randomUUID(),
          debitedAccountId: cmd.payload.suspenseAccountId,
          creditedAccountId: cmd.payload.payerClearingAccountId,
          amount: cmd.payload.amount,
          amountScale: cmd.payload.amountScale,
          timestamp: now,
          externalId: cmd.payload.transferId
        }
      })
    );

    this._recordAndApplyStateEvent(
      new LedgerTransactionRecordedStateEvent(this._id, {
        transaction: {
          id: crypto.randomUUID(),
          debitedAccountId: cmd.payload.payerClearingAccountId,
          creditedAccountId: cmd.payload.payeeClearingAccountId,
          amount: cmd.payload.amount,
          amountScale: cmd.payload.amountScale,
          timestamp: now,
          externalId: cmd.payload.transferId
        }
      })
    );

    if (cmd.payload.transferDirection === 'OUTGOING') {
      this._recordDomainEvent(
        new LedgerOutgoingTransferCommittedEvent(this._id, {
          requestId: cmd.payload.requestId,
          transferId: cmd.payload.transferId,
          isError: false
        }),
        cmd.requestId
      );
    } else {
      this._recordDomainEvent(
        new LedgerIncomingTransferCommittedEvent(this._id, {
          requestId: cmd.payload.requestId,
          transferId: cmd.payload.transferId,
          isError: false
        }),
        cmd.requestId
      );
    }
  }

  private async _processRejectTransferCmd(
    cmd: RejectTransferCmd
  ): Promise<void> {
    const suspenseAccount = this._accounts.find(
      (a) => a.id === cmd.payload.suspenseAccountId
    );
    const payerClearingAccount: ILedgerAccount | undefined =
      this._accounts.find((a) => a.id === cmd.payload.payerClearingAccountId);
    if (!payerClearingAccount || !suspenseAccount) {
      this._recordDomainEvent(
        new LedgerAccountNotFoundEvent({
          assetCode: this._id,
          accountId: cmd.payload.payerClearingAccountId
        }),
        cmd.requestId
      );
      this._logger.warn('Account(s) not found in RejectTransferCmd');
      return;
    }

    this._recordAndApplyStateEvent(
      new LedgerTransactionRecordedStateEvent(this._id, {
        transaction: {
          id: crypto.randomUUID(),
          debitedAccountId: cmd.payload.suspenseAccountId,
          creditedAccountId: cmd.payload.payerClearingAccountId,
          amount: cmd.payload.amount,
          amountScale: cmd.payload.amountScale,
          timestamp: Date.now(),
          externalId: cmd.payload.transferId
        }
      })
    );

    if (cmd.payload.transferDirection === 'OUTGOING') {
      this._recordDomainEvent(
        new LedgerOutgoingTransferRejectedEvent(this._id, {
          requestId: cmd.payload.requestId,
          transferId: cmd.payload.transferId,
          isError: false
        }),
        cmd.requestId
      );
    } else {
      this._recordDomainEvent(
        new LedgerIncomingTransferRejectedEvent(this._id, {
          requestId: cmd.payload.requestId,
          transferId: cmd.payload.transferId,
          isError: false
        }),
        cmd.requestId
      );
    }
  }

  /*
   * public
   * */

  // load the aggregate from the snapshot and events
  async load(
    snapshot: LedgerSnapshotEvent | null,
    events: LedgerStateEvent[],
    replayed: boolean = false
  ): Promise<boolean> {
    this._logger.debug(
      `Ledger ${this.id} at version ${this._version} - going to load from ${snapshot ? '1' : '(no)'} snapshot and ${events.length} events - replayed: ${replayed} ...`
    );

    if (!snapshot && !events.length) {
      return false;
    }

    if (snapshot) {
      this._applySnapshot(snapshot);
    }
    if (!events.length) {
      // return true/ok if no events found but a snapshot exists
      if (snapshot) {
        this._logger.debug(
          `Ledger ${this.id} - loaded from snapshot at version: ${this.version}, last snapshot version: ${this.lastSnapshotVersion}, accounts count: ${this.accountsCount}, transactions count: ${this.transactionsCount}`
        );
        return true;
      }
      this._logger.warn(
        `Ledger ${this.id} - not loaded - no snapshots or events provided`
      );
      return false;
    }

    this.applyEvents(events, replayed);
    return true;
  }

  applyEvents(events: LedgerStateEvent[], replayed: boolean): void {
    if (events.length <= 0) return;
    // if replaying and last event is older than the current version, ignore it
    if (
      replayed &&
      this._version > BigInt(events[events.length - 1].aggregateVersion)
    ) {
      this._logger.debug(
        `Ledger ${this.id} - ignoring older events when replaying, last has version ${events[events.length - 1].aggregateVersion} and ledger is at version ${this._version}`
      );
      return;
    }

    for (const event of events) {
      this._applyEvent(event, replayed);
    }

    // confirm the version of the last event matches the current version
    if (this._version !== BigInt(events[events.length - 1].aggregateVersion)) {
      throw new Error('Version mismatch');
    }

    this._logger.debug(
      `Ledger ${this.id} - applied ${events.length} event(s), current version is: ${this.version}, last snapshot version: ${this.lastSnapshotVersion}, accounts count: ${this.accountsCount}, transactions count: ${this.transactionsCount}`
    );
    return;
  }

  async processCommand(ledgerCmd: LedgerCommand): Promise<void> {
    if (LedgerCommand.isCreateLedgerAccountForAssetCmd(ledgerCmd)) {
      // low level
      await this._processCreateLedgerAccountForAssetCmd(ledgerCmd);
    } else if (LedgerCommand.isCreateLedgerAccountsForPeerCmd(ledgerCmd)) {
      await this._processCreateLedgerAccountsForPeerCmd(ledgerCmd);
    } else if (LedgerCommand.isPostTransactionCmd(ledgerCmd)) {
      await this._processPostTransactionCmd(ledgerCmd);
    } else if (LedgerCommand.isReserveTransferCmd(ledgerCmd)) {
      // high level
      await this._processReserveTransferCmd(ledgerCmd);
    } else if (LedgerCommand.isCheckBalanceAndReserveTransferCmd(ledgerCmd)) {
      await this._processCheckBalanceAndReserveCmd(ledgerCmd);
    } else if (LedgerCommand.isCommitTransferCmd(ledgerCmd)) {
      await this._processCommitTransferCmd(ledgerCmd);
    } else if (LedgerCommand.isRejectTransferCmd(ledgerCmd)) {
      await this._processRejectTransferCmd(ledgerCmd);
    } else {
      throw new Error(`unhandled command with msgName: '${ledgerCmd.msgName}'`);
    }

    //this._logger.debug(`Ledger ${this.id} - processed command: ${cmd.msgName}`);
  }

  executeSnapshot(): LedgerSnapshotEvent {
    // NOTE snapshots store the current version, as such
    // they mustn't change anything, only take a picture

    const snapshot = new LedgerSnapshotEvent(
      this.id,
      this._version.toString(),
      {
        assetScale: this._assetScale,
        accounts: this._accounts.map(LedgerAccountDtoSerializer.toDTO),
        transactionCount: this._transactionCount.toString()
      }
    );

    this._lastSnapshotVersion = this._version;
    return snapshot;
  }

  clearUncommittedEvents(): void {
    this._uncommittedStateEvents.length = 0;
  }

  clearUncommittedDomainEvents(): void {
    this._uncommittedDomainEvents.length = 0;
  }

  getAccounts(ids: string[]): ReadonlyArray<ILedgerAccount> {
    const list: ILedgerAccount[] = [];
    // not ideal but keeps the order of the ids
    ids.forEach((id) => {
      const account = this._accounts.find((a) => a.id === id);
      if (account) {
        list.push(account);
      }
    });
    return list;
  }

  printStats() {
    const header = 'LEDGER STATE ' + '-'.repeat(20);
    const footer = '-'.repeat(header.length);

    let output = `Version:               ${this._version}\n`;
    output += `Last snapshot version: ${this._lastSnapshotVersion}\n`;
    output += `Accounts:              ${this._accounts.length}\n`;
    output += `Transactions:          ${this._transactionCount}`;

    this._logger.info(`${header}\n${output}\n${footer}\n`);
  }

  verify(): boolean {
    let totalDebited = 0n;
    let totalCredited = 0n;
    this._accounts.forEach((account) => {
      totalDebited += account.debitedAmount;
      totalCredited += account.creditedAmount;
    });

    return totalDebited == totalCredited;
  }

  // DTO serialization functions

  toDTO(): ILedgerDto {
    return {
      id: this.id,
      assetScale: this.assetScale,
      version: this.version.toString()
    };
  }
}
