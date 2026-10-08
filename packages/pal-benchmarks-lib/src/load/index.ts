import {
  CheckBalanceAndReserveTransferCmd,
  CommitTransferCmd,
  LedgerCommand
} from 'pal-domain-lib';
import {
  KafkaBuilder,
  KafkaConsumerOptions,
  KafkaProducerCompressionCodecs,
  KafkaProducerOptions,
  MessageSerializationFactory
} from 'implementations-lib';
import {
  CreateLedgerAccountForAssetCmdSerde,
  CreateLedgerAccountsForPeerCmdSerde,
  CreateLedgerCmdSerde,
  LedgerAccountsCreatedStateEventSerde,
  LedgerCreatedStateEventSerde,
  LedgerSnapshotSerde,
  LedgerTransactionRecordedStateEventSerde
} from 'pal-implementations-lib';
import {
  CommandMsg,
  DomainEvent,
  DomainEventTopics,
  ILogger,
  IMessage,
  IMessageConsumer,
  IMessageProducer,
  ITelemetryHistogram,
  ITelemetryService,
  MessageTypes,
  TELEMETRY_PROPS_CALL_NAME_PROP
} from 'common-types-lib';
import { DEFAULT_ASSET_SCALE, ISettingsData } from '../common';
import {
  ILedgerAccountDto,
  IPalAssetDto,
  IPalPeerDto,
  LedgerDomainEvent
} from 'pal-public-types-lib';
import { EventEmitter } from 'node:events';
import { PalClient } from 'pal-client-lib';
import { clearInterval } from 'node:timers';

// kafka common options
const kafkaProducerCommonOptions: KafkaProducerOptions = {
  compressionCodec: KafkaProducerCompressionCodecs.ZSTD,
  compressionLevel: 3,
  queueBufferingMaxMessages: 500_000,
  messageMaxBytes: 20971520 * 2,
  skipAcknowledgements: false
};
const kafkaConsumerCommonOptions: KafkaConsumerOptions = {
  consumerGroupId: `ES_LEDGER_LOAD_TESTS_${crypto.randomUUID()}`,
  batchTimeoutMs: 1,
  batchSize: 500_000,
  autoOffsetReset: 'latest'
};

const RESPONSE_TOPICS_TO_LISTEN_TO = [DomainEventTopics.LedgerEvents];
const RESPONSES_HISTOGRAM_NAME = 'LoadTestsResponses_histo';

const SLIDING_WINDOW_SECS = 10; // "last X seconds for avg duration"
const BALANCE_UPDATE_INTERVAL_SECS = 5;

export interface IAccBalances {
  aseLiq?: string;
  aseCle?: string;
  peerLiq?: string;
  peerCle?: string;
  susp?: string;
}

export interface ILoadTestStats {
  isRunning: boolean;
  perSecCount: number;
  lastPublishCycleTookMs: number;
  lastConsumeCycleTookMs: number;
  runningForSecs: number;
  totalMessagesSent: number;
  totalMessagesPending: number;
  avgTimePerMessageMs: number;
}

export interface ILoadTestEvents {
  statsAvailable: [stats: ILoadTestStats];
  stateChanged: [];
  logAvailable: [logLine: string];
}

export class LoadTests extends EventEmitter<ILoadTestEvents> {
  private _settings: ISettingsData;
  private _instanceId: string;
  private _perSecCount: number;
  private _apiClient: PalClient;
  private _logger: ILogger;
  private _kafkaBuilder: KafkaBuilder | null = null;
  private _msgProducer: IMessageProducer | null = null;
  private _msgConsumer: IMessageConsumer | null = null;
  private _telemetryService: ITelemetryService | null = null;
  private _responsesHisto: ITelemetryHistogram | null = null;

  private _asset: IPalAssetDto | null = null;
  private _peer: IPalPeerDto | null = null;
  private _accounts: ILedgerAccountDto[] = [];

  private _balances: IAccBalances = {};

  private _totalMessagesSent = 0;
  private _pendingResponseCount = 0;
  private _errorResponseCount = 0;
  private _totalTimeMs = 0;
  private _runStartTs: number = 0;
  private _lastPublishCycleTookTs: number = 0;
  private _lastConsumeCycleTookMs: number = 0;
  private _commandsSent: CommandMsg[] = [];
  private _isRunning = false;
  private _stopRequested = false;
  private _connected = false;

  private _durationBuckets: { sum: number; count: number }[];
  private _currentBucketSec: number | null = null;

  private _statsUpdateTimer: NodeJS.Timeout | null = null;

  constructor(
    settings: ISettingsData,
    apiClient: PalClient,
    perSecCount: number,
    logger: ILogger,
    instanceId?: string,
    telemetryService?: ITelemetryService
  ) {
    super();
    this._logger = logger.child(this.constructor.name);
    this._settings = settings;
    this._perSecCount = perSecCount;
    this._instanceId =
      instanceId ?? `ES_LEDGER_POC_TEST__${crypto.randomUUID()}`;

    // init the sliding window of duration buckets with zeros
    this._durationBuckets = new Array(SLIDING_WINDOW_SECS).fill({
      sum: 0,
      count: 0
    });

    this._apiClient = apiClient;

    if (telemetryService) {
      this._telemetryService = telemetryService;
      this._responsesHisto = this._telemetryService.getHistogram(
        RESPONSES_HISTOGRAM_NAME
      );
    }
  }

  public get connected(): boolean {
    return this._connected;
  }

  public get isRunning(): boolean {
    return this._isRunning;
  }

  public get apiClient(): PalClient {
    return this._apiClient;
  }

  public get perSecCount(): number {
    return this._perSecCount;
  }
  public set perSecCount(perSecCount: number) {
    this._perSecCount = perSecCount;
  }

  public get asset(): IPalAssetDto | null {
    return this._asset;
  }
  public get peer(): IPalPeerDto | null {
    return this._peer;
  }
  public get accounts(): ILedgerAccountDto[] {
    return this._accounts;
  }
  public get balances(): IAccBalances {
    return this._balances;
  }
  public get errorResponseCount(): number {
    return this._errorResponseCount;
  }

  public get commandsSent(): number {
    return this._commandsSent.length;
  }

  async init(): Promise<void> {
    if (this._connected) return;

    await this._apiClient.init();
    await this._fetchAssetAndPeerFromApi();
    await this._fetchAccountsFromApi();
    await this._updateAccountBalances();
    if (this.checkSetupRequired()) {
      this._logger.debug(
        'No asset, peer or accounts exists, should run setup?'
      );
    }

    MessageSerializationFactory.instance()
      // snapshots
      .register(new LedgerSnapshotSerde())
      // state events
      .register(new LedgerCreatedStateEventSerde())
      .register(new LedgerAccountsCreatedStateEventSerde())
      .register(new LedgerTransactionRecordedStateEventSerde())
      // commands
      .register(new CreateLedgerCmdSerde())
      // .register(new PostTransactionCmdSerde())
      .register(new CreateLedgerAccountForAssetCmdSerde())
      .register(new CreateLedgerAccountsForPeerCmdSerde());

    this._kafkaBuilder = new KafkaBuilder()
      .withLogger(this._logger)
      .withSerializerFactory(MessageSerializationFactory.instance())
      .withBrokerList(this._settings.kafkaUrl)
      .withClientId(this._instanceId);

    if (this._telemetryService) {
      this._kafkaBuilder.withTelemetry(this._telemetryService);
    }

    this._msgProducer = this._kafkaBuilder.buildProducer(
      kafkaProducerCommonOptions
    );
    // this._msgProducer = kafkaBuilder.buildProducerNew();
    await this._msgProducer.connect();

    this._msgConsumer = this._kafkaBuilder.buildLowLevelConsumer(
      kafkaConsumerCommonOptions
    );
    this._msgConsumer.setTopics(RESPONSE_TOPICS_TO_LISTEN_TO);
    this._msgConsumer.setBatchCallbackFn(
      this._handleDomainEventsBatch.bind(this)
    );
    await this._msgConsumer.connect();
    await this._msgConsumer.startAndWaitForRebalance();

    this._connected = true;
    this.emit('stateChanged');
  }

  checkSetupRequired(): boolean {
    return !this._asset || !this._peer || this._accounts.length === 0;
  }

  async setupLedger(): Promise<void> {
    const startTs = Date.now();

    if (!this._msgProducer) {
      throw new Error('Producer not initialized');
    }
    if (!this._asset) {
      this._log('Asset not found, creating...');
      await this._apiClient.createAsset(
        this._settings.assetCode,
        DEFAULT_ASSET_SCALE
      );
      const [asset] = await this._apiClient.getAssets([
        this._settings.assetCode
      ]);
      this._asset = asset ?? null;
      this._log(
        `Asset created: ${this._asset?.code} scale: ${this._asset?.scale}`
      );
    } else {
      this._log('Asset found, skipping creation.');
    }

    if (!this._peer) {
      this._log('Peer not found, creating...');
      await this._apiClient.createPeer(
        this._settings.peerId,
        `Benchmarks Test Peer - ${this._settings.testIdPrefix}`,
        this._settings.assetCode,
        DEFAULT_ASSET_SCALE,
        'ilpPrefix'
      );
      this._peer = await this._apiClient.getPeer(this._settings.peerId);
      this._log(
        `Peer created: ${this._peer?.name} - active: ${this._peer?.active}`
      );
    } else {
      this._log('Peer found, skipping creation.');
    }

    if (!this._accounts.length) {
      this._log('Accounts not found, creating...');
      let tries = 0;
      while (true) {
        await this._fetchAccountsFromApi();
        if (this._accounts.length > 0) break;

        if (tries++ > 10) {
          this._log(
            `Peer creation failed, could not get accounts after ${tries} tries.`
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } else {
      this._log('Accounts found, skipping creation.');
    }
    //
    // this._log('Requesting ASE deposit...');
    //
    // await this._apiClient.ledgerDepositToAse({
    //   requestId: randomUUID(),
    //   assetCode: this._settings.assetCode,
    //   peerId: this._settings.peerId,
    //   amount: 0,
    //   amountScale: ASSET_SCALE
    // });

    const endTs = Date.now();
    this._log(`Setup - Created ledger and accounts in ${endTs - startTs}ms`);
  }

  async startOrStop(): Promise<void> {
    if (this._isRunning) {
      this.stop();
    } else {
      await this.start();
    }
  }

  async start(): Promise<void> {
    if (!this._msgProducer) {
      throw new Error('Producer not initialized');
    }
    if (this._isRunning) return;

    this._statsUpdateTimer = setInterval(() => {
      this._calcStatsAndNotify();
    }, 1000);

    this._stopRequested = false;
    this._isRunning = true;
    await this._runCycle();
    this._isRunning = false;
  }

  stop(): void {
    this._log(`Stopping load test in next cycle...`);
    this._stopRequested = true;
  }

  resetStats(): void {
    this._totalTimeMs = 0;
    this._totalMessagesSent = 0;
    this._lastPublishCycleTookTs = 0;
    this._lastConsumeCycleTookMs = 0;
    this._errorResponseCount = 0;
    this._pendingResponseCount = 0;

    this._durationBuckets = new Array(SLIDING_WINDOW_SECS).fill({
      sum: 0,
      count: 0
    });
    this._currentBucketSec = null;
  }

  async updateAccountBalancesNow(): Promise<void> {
    await this._updateAccountBalances();
  }

  private _stopCycle() {
    this._stopRequested = false;
    this._isRunning = false;

    if (this._statsUpdateTimer) {
      clearInterval(this._statsUpdateTimer);
      this._statsUpdateTimer = null;
    }
    // update to clear any intermediate state
    this._calcStatsAndNotify();

    this.emit('stateChanged');
  }

  private async _runCycle(): Promise<void> {
    const cmds: CommandMsg[] = [];
    this._runStartTs = Date.now();
    let cycleStartTs: number, sendStartTs: number, sendDuration: number;

    this.emit('stateChanged');

    while (true) {
      if (this._stopRequested) {
        this._stopCycle();
        break;
      }

      cmds.length = 0;
      cycleStartTs = Date.now();

      // cmds.push(...this._getSimpleTransactionTestCommands());
      cmds.push(...this._getComplexTransactionTestCommands());

      this._commandsSent.push(...cmds);

      sendStartTs = Date.now();
      await this._msgProducer!.send(cmds);
      this._pendingResponseCount += cmds.length;
      this._totalMessagesSent += cmds.length;
      sendDuration = Date.now() - sendStartTs;
      this._lastPublishCycleTookTs = Date.now() - cycleStartTs;

      this._log(
        `${cmds.length} transactions posted, publishing took: ${sendDuration} ms - cycle took: ${this._lastPublishCycleTookTs}`
      );
      if (this._lastPublishCycleTookTs < 1000) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 - this._lastPublishCycleTookTs)
        );
      } else {
        console.warn(
          `WARNING - Cycle took longer than 1 second: ${this._lastPublishCycleTookTs} ms`
        );
      }

      // update balances from API every X seconds
      if (new Date().getSeconds() % BALANCE_UPDATE_INTERVAL_SECS === 0) {
        await this._updateAccountBalances();
      }
    }
  }

  private async _handleDomainEventsBatch(events: IMessage[]): Promise<void> {
    const cycleStartTs = Date.now();
    const retCommands: CommandMsg[] = [];

    for (const event of events) {
      if (
        event.msgTopic != DomainEventTopics.LedgerEvents ||
        event.msgType != MessageTypes.DOMAIN_EVENT
      ) {
        continue;
      }

      retCommands.push(
        ...this._handleComplexTransactionLedgerEvent(event as DomainEvent)
      );
    }

    if (retCommands.length > 0) {
      await this._msgProducer!.send(retCommands);
    }

    this._lastConsumeCycleTookMs = Date.now() - cycleStartTs;
    this._log(
      `Received and processed ${events.length} events - sent ${retCommands.length} response commands - consume cycle took: ${this._lastConsumeCycleTookMs} ms`
    );
  }

  private _handleComplexTransactionLedgerEvent(
    event: DomainEvent
  ): CommandMsg[] {
    let isLastEventInFlow = false;
    let originalCommandRequestId: string | null = null;
    const returnCommands: CommandMsg[] = [];

    if (LedgerDomainEvent.isLedgerOutgoingTransferReservedEvent(event)) {
      // 2nd step, reservation was successful, we must now send the commit cmd
      returnCommands.push(
        new CommitTransferCmd(this._settings.assetCode, {
          requestId: event.payload.requestId,
          transferId: event.payload.transferId,
          paymentId: event.payload.paymentId,
          paymentIntentId: event.payload.paymentIntentId,
          transferDirection: 'OUTGOING'
        })
      );
      originalCommandRequestId = event.payload.requestId;
    } else if (
      LedgerDomainEvent.isLedgerOutgoingTransferCommittedEvent(event)
    ) {
      // 3rd step, transfer was completed
      originalCommandRequestId = event.payload.requestId;
      isLastEventInFlow = true;
    } else if (
      LedgerDomainEvent.isLedgerOutgoingTransferCommitFailedEvent(event)
    ) {
      originalCommandRequestId = event.payload.requestId;
      isLastEventInFlow = true;
      this._errorResponseCount++;
      this._log(
        `TransferCommitFailed for requestId: ${event.payload.requestId} with: ${event.payload.errorMessage}`
      );
    } else if (
      LedgerDomainEvent.isLedgerOutgoingTransferInsufficientFundsErrorEvent(
        event
      )
    ) {
      originalCommandRequestId = event.payload.requestId;
      isLastEventInFlow = true;
      this._errorResponseCount++;
      this._log(
        `InsufficientFundsError for requestId: ${event.payload.requestId} with: ${event.payload.errorMessage}`
      );
    } else if (event.isErrorEvent) {
      this._errorResponseCount++;
    }

    if (originalCommandRequestId) {
      const index = this._commandsSent.findIndex(
        (cmd) => cmd.payload.requestId === originalCommandRequestId
      );

      if (index >= 0) {
        const timeTakenMs = Date.now() - this._commandsSent[index].msgTimestamp;

        if (LedgerDomainEvent.isLedgerOutgoingTransferReservedEvent(event)) {
          this._responsesHisto?.observe(timeTakenMs * 10 ** 6, {
            [TELEMETRY_PROPS_CALL_NAME_PROP]:
              CheckBalanceAndReserveTransferCmd.name
          });
        } else if (
          LedgerDomainEvent.isLedgerOutgoingTransferCommittedEvent(event)
        ) {
          this._responsesHisto?.observe(timeTakenMs * 10 ** 6, {
            [TELEMETRY_PROPS_CALL_NAME_PROP]: 'Full reserve + commit'
          });
        } else {
          this._responsesHisto?.observe(timeTakenMs * 10 ** 6, {
            [TELEMETRY_PROPS_CALL_NAME_PROP]: 'Error / not handled'
          });
        }

        // remove original command if last event of sequence
        if (isLastEventInFlow) {
          this._recordDuration(timeTakenMs);
          this._totalTimeMs += timeTakenMs;

          this._pendingResponseCount--;
          this._commandsSent.splice(index, 1);
        }
      }
    }

    return returnCommands;
  }

  private async _fetchAssetAndPeerFromApi(): Promise<void> {
    const accountIds: string[] = [];

    const [asset] = await this._apiClient.getAssets([this._settings.assetCode]);
    this._asset = asset ?? null;
    if (this._asset) {
      this._log(`Got asset data for assetCode: ${this._asset.code}`);

      if (this._asset.ledgerAccountId) {
        accountIds.push(this._asset.ledgerAccountId);
      }
    }

    this._peer = await this._apiClient.getPeer(this._settings.peerId);
    if (this._peer) {
      this._log(
        `Got peer data for peerId: ${this._peer.id} name: ${this._peer.name}`
      );

      if (this._peer.ledgerAccounts) {
        accountIds.push(
          this._peer.ledgerAccounts.aseLiquidityAccId,
          this._peer.ledgerAccounts.aseClearingAccId,
          this._peer.ledgerAccounts.peerLiquidityAccId,
          this._peer.ledgerAccounts.peerClearingAccId,
          this._peer.ledgerAccounts.suspenseAccId
        );
      }
    }

    if (accountIds.length) {
      this._accounts = await this._apiClient.getLedgerAccounts(accountIds);

      if (this._accounts) {
        this._log(`Got accounts data for accountIds: ${accountIds}`);
      }
    }
  }

  private async _updateAccountBalances(): Promise<void> {
    if (!this._accounts || this._accounts.length <= 0) return;

    const ids = this._accounts.map((a) => a.id);
    const accs = await this._apiClient.getLedgerAccounts(ids);

    accs.forEach((acc) => {
      const deb = BigInt(acc.debitedAmount);
      const cred = BigInt(acc.creditedAmount);
      const bal = (cred - deb).toString();
      const balStr = this._apiClient.amountStrToDisplayAmountStr(
        bal,
        acc.assetDisplayScale
      );

      if (acc.type === 'ASE_LIQUIDITY_ACCOUNT') {
        this._balances.aseLiq = balStr;
      } else if (acc.type === 'ASE_CLEARING_ACCOUNT') {
        this._balances.aseCle = balStr;
      } else if (acc.type === 'PEER_LIQUIDITY_ACCOUNT') {
        this._balances.peerLiq = balStr;
      } else if (acc.type === 'PEER_CLEARING_ACCOUNT') {
        this._balances.peerCle = balStr;
      } else if (acc.type === 'SUSPENSE_ACCOUNT') {
        this._balances.susp = balStr;
      }
    });
  }

  private async _fetchAccountsFromApi(): Promise<void> {
    const accountIds: string[] = [];

    if (this._asset && this._asset.ledgerAccountId) {
      accountIds.push(this._asset.ledgerAccountId);
    }

    if (this._peer && this._peer.ledgerAccounts) {
      accountIds.push(
        this._peer.ledgerAccounts.aseLiquidityAccId,
        this._peer.ledgerAccounts.aseClearingAccId,
        this._peer.ledgerAccounts.peerLiquidityAccId,
        this._peer.ledgerAccounts.peerClearingAccId,
        this._peer.ledgerAccounts.suspenseAccId
      );
    }

    if (accountIds.length) {
      this._accounts = await this._apiClient.getLedgerAccounts(accountIds);

      if (this._accounts) {
        const str = this._accounts.map((a) => `${a.name} - ${a.type}`);
        this._log(`Got accounts data for accountIds: ${str}`);
      }
    }
  }

  private _recordDuration(durationMs: number): void {
    const nowSec = Math.floor(Date.now() / 1000);

    if (!this._currentBucketSec) this._currentBucketSec = nowSec;

    const secsElapsed = nowSec - this._currentBucketSec;
    if (secsElapsed > 0) {
      // We're on a new bucket, clear it, along with any skipped buckets
      const toClear = Math.min(secsElapsed, SLIDING_WINDOW_SECS);
      for (let i = 1; i <= toClear; i++) {
        const index = (this._currentBucketSec + i) % SLIDING_WINDOW_SECS;
        this._durationBuckets[index] = { sum: 0, count: 0 };
      }
      // set the current bucket time
      this._currentBucketSec = nowSec;
    }

    const index = nowSec % SLIDING_WINDOW_SECS;
    this._durationBuckets[index].sum += durationMs;
    this._durationBuckets[index].count++;
  }

  private get _slidingWindowAvgMs(): number {
    const { sum, count } = this._durationBuckets.reduce(
      (acc, b) => ({ sum: acc.sum + b.sum, count: acc.count + b.count }),
      { sum: 0, count: 0 }
    );
    return count === 0 ? 0 : sum / count;
  }

  private _calcStatsAndNotify() {
    const stats: ILoadTestStats = {
      isRunning: this._isRunning,
      perSecCount: this._perSecCount,
      lastPublishCycleTookMs: this._lastPublishCycleTookTs,
      lastConsumeCycleTookMs: this._lastConsumeCycleTookMs,
      runningForSecs: (Date.now() - this._runStartTs) / 1000,
      totalMessagesSent: this._totalMessagesSent,
      totalMessagesPending: this._pendingResponseCount,
      avgTimePerMessageMs: this._slidingWindowAvgMs
      // avgTimePerMessageMs:
      //   this._totalTimeMs /
      //   (this._totalMessagesSent - this._pendingResponseCount)
    };

    this.emit('statsAvailable', stats);
  }

  private _getComplexTransactionTestCommands(): LedgerCommand[] {
    const cmds: CommandMsg[] = [];

    for (let i = 0; i < this._perSecCount; i++) {
      const amount = BigInt(Math.round(Math.random() * 1000)).toString();
      const reqId = `${this._settings.testIdPrefix}_${i + this._totalMessagesSent}`;

      cmds.push(
        new CheckBalanceAndReserveTransferCmd(this._settings.assetCode, {
          requestId: reqId,
          transferId: `${reqId}_transferId`,
          paymentIntentId: `${reqId}_paymentIntentId`,
          paymentId: `${reqId}_paymentIntentId`,
          peerId: this._settings.peerId,
          transferDirection: 'OUTGOING',
          amount: amount,
          amountScale: 2
        })
      );
    }

    return cmds;
  }

  private _getRandomPair(array: string[]): [string, string] | undefined {
    if (array.length < 2) return undefined;

    const firstIndex = Math.floor(Math.random() * array.length);
    let secondIndex = Math.floor(Math.random() * array.length);

    while (secondIndex === firstIndex) {
      secondIndex = Math.floor(Math.random() * array.length);
    }
    return [array[firstIndex], array[secondIndex]];
  }

  private _log(args: string): void {
    if (!this._settings.disableConsoleLog) console.error(args);

    this.emit('logAvailable', args);
  }
}
