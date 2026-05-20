import { Ledger } from './entities/ledger';
import { CreateLedgerCmd, LedgerCommand } from './messages/commands';
import { LedgerCreatedStateEvent, LedgerStateEvent } from './messages/events';
import console from 'node:console';
import { ILedgerAccount } from './entities/ledger-account';
import { ILedgerEventSourcingRepository } from './interfaces';
import {
  CommandMsg,
  ILogger,
  IMessageProducer,
  MessageTypes
} from 'common-types-lib';
import {
  LedgerDomainEvent,
  LedgerCreatedEvent,
  LedgerCreationFailedEvent,
  LedgerNotFoundEvent
} from 'pal-public-types-lib';

const INTERNAL_ASSET_SCALE = 20;

export class LedgerAggregate {
  private readonly _logger: ILogger;
  private readonly _ledgers: Map<string, Ledger>;
  private readonly _esRepo: ILedgerEventSourcingRepository;
  private readonly _msgProducer: IMessageProducer;
  private readonly _uncommittedStateEvents: LedgerStateEvent[];
  private readonly _uncommittedDomainEvents: LedgerDomainEvent[];

  constructor(
    esRepo: ILedgerEventSourcingRepository,
    msgProducer: IMessageProducer,
    logger: ILogger
  ) {
    this._esRepo = esRepo;
    this._msgProducer = msgProducer;
    this._logger = logger;
    this._ledgers = new Map<string, Ledger>();
    this._uncommittedStateEvents = [];
    this._uncommittedDomainEvents = [];
  }

  private async _processSingleCommand(command: LedgerCommand): Promise<void> {
    // detect commands for the aggregate (i.e., not for a specific ledger)
    if (LedgerCommand.isCreateLedgerCmd(command)) {
      await this._processCreateLedgerCmd(command);
    } else {
      // ledger-specific commands, load it first
      const ledger = await this.getOrLoadLedger(command.aggregateId);

      if (!ledger) {
        const errEvt = new LedgerNotFoundEvent({
          assetCode: command.aggregateId
        });
        errEvt.requestId = command.requestId;
        this._uncommittedDomainEvents.push(errEvt);
        this._logger.warn(
          `Ledger with asset code: ${command.aggregateId} not found`
        );
        return;
      }

      await ledger.processCommand(command);

      this._uncommittedStateEvents.push(...ledger.uncommittedStateEvents);
      ledger.clearUncommittedEvents();
      this._uncommittedDomainEvents.push(...ledger.uncommittedDomainEvents);
      ledger.clearUncommittedDomainEvents();
    }
  }

  private async _processCreateLedgerCmd(cmd: CreateLedgerCmd): Promise<void> {
    const existing = await this.getOrLoadLedger(cmd.aggregateId);
    if (existing) {
      const errorEvt = new LedgerCreationFailedEvent({
        assetCode: cmd.aggregateId,
        reason: 'DUPLICATE_ASSET_CODE'
      });
      errorEvt.requestId = cmd.requestId;
      this._uncommittedDomainEvents.push(errorEvt);
      this._logger.warn(`Ledger for asset: ${cmd.aggregateId} already exists`);
      return;
    }

    const newLedger = Ledger.CreateNewLedger(
      cmd.aggregateId,
      INTERNAL_ASSET_SCALE,
      this._logger
    );

    this._ledgers.set(cmd.aggregateId, newLedger);

    this._uncommittedStateEvents.push(
      new LedgerCreatedStateEvent(cmd.aggregateId, INTERNAL_ASSET_SCALE)
    );

    const domainEvent = new LedgerCreatedEvent({ assetCode: cmd.aggregateId });
    domainEvent.requestId = cmd.requestId;
    this._uncommittedDomainEvents.push(domainEvent);
  }

  async processCommands(commands: CommandMsg | CommandMsg[]): Promise<void> {
    const startTs = Date.now();
    if (!Array.isArray(commands)) {
      commands = [commands];
    }

    for (const cmd of commands) {
      if (cmd.msgType !== MessageTypes.COMMAND) {
        this._logger.warn(
          `Invalid message type: ${cmd.msgType} - expected command`
        );
        continue;
      }
      if (!cmd.aggregateId) {
        this._logger.warn('Invalid aggregateId in command');
        continue;
      }
      await this._processSingleCommand(cmd as LedgerCommand);
    }
    const procMs = Date.now() - startTs;

    // publish and clear uncommited events
    const preEsrepoPublishStart = Date.now();
    const eventsCount =
      this._uncommittedStateEvents.length +
      this._uncommittedDomainEvents.length;
    await this._esRepo.publishEvents(this._uncommittedStateEvents);
    const esRepoMs = Date.now() - preEsrepoPublishStart;

    const prePublishStart = Date.now();
    this._uncommittedStateEvents.length = 0;
    await this._msgProducer.send(this._uncommittedDomainEvents);
    this._uncommittedDomainEvents.length = 0;
    const producerMs = Date.now() - prePublishStart;

    this._logger.debug(
      `LedgerAggregate: processed ${commands.length} commands and published ${eventsCount} events in ${Date.now() - startTs}ms - proc: ${procMs}ms esRepo pub: ${esRepoMs}ms producer pub: ${producerMs}ms`
    );
  }

  async getOrLoadLedger(
    ledgerId: string,
    replayed: boolean = false
  ): Promise<Ledger | null> {
    const loadedLedger = this._ledgers.get(ledgerId);

    // TODO detect partition changes (rebalancing) so we can force load before continuing
    if (loadedLedger) {
      return loadedLedger;
    }

    const startTs = Date.now();

    // try to load the ledger state from event-sourcing repo snapshot+events
    const snapshot = await this._esRepo.fetchLastSnapshot(ledgerId);

    let partitionAndOffset: { partition: number; offset: number } | undefined =
      undefined;
    if (snapshot?.lastEventIndexOffset && snapshot?.lastEventIndexPartition) {
      partitionAndOffset = {
        partition: snapshot.lastEventIndexPartition,
        offset: snapshot.lastEventIndexOffset + 1 // we want to start reading the next message, not the last one that made it to the snapshot
      };
    }
    const events = await this._esRepo.fetchStateEvents(
      ledgerId,
      partitionAndOffset
    );

    if (!snapshot && events.length <= 0) {
      return null; // cannot load from event-sourcing repo
    }

    const ledger = Ledger.GetUnloadedLedger(ledgerId, this._logger);
    const loaded = await ledger.load(snapshot, events, replayed);
    if (!loaded) {
      return null;
    }

    this._ledgers.set(ledgerId, ledger);

    this._logger.info(
      `LedgerAggregate: ledger loading took: ${Date.now() - startTs}ms`
    );
    return ledger;
  }

  getAccounts(ids: string[]): ReadonlyArray<ILedgerAccount> {
    const foundAccounts: ILedgerAccount[] = [];

    for (const ledger of this._ledgers.values()) {
      const accounts = ledger.getAccounts(ids);
      foundAccounts.push(...accounts);
    }
    return foundAccounts as ReadonlyArray<ILedgerAccount>;
  }

  printStats() {
    for (const ledger of this._ledgers.values()) {
      const header = `${'-'.repeat(10)} LEDGER STATE for ledger Id: ${ledger.id} ${'-'.repeat(10)}`;
      const footer = '-'.repeat(header.length);

      let output = `Version:                ${ledger.version}\n`;
      output += `Last snapshot version:  ${ledger.lastSnapshotVersion}\n`;
      output += `Accounts count:         ${ledger.accountsCount}\n`;
      output += `Transactions count:     ${ledger.transactionsCount}`;

      console.log(`${header}\n${output}\n${footer}\n`);
    }
  }

  verify(): boolean {
    this._ledgers.forEach((ledger) => {
      if (!ledger.verify()) {
        return false;
      }
    });
    return true;
  }
}
