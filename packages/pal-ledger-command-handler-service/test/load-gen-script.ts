import {
  KafkaBuilder,
  KafkaProducerCompressionCodecs,
  KafkaProducerOptions,
  MessageSerializationFactory
} from 'implementations-lib';
import { CommandMsg, ConsoleLogger, IMessageProducer } from 'common-types-lib';
import {
  CreateLedgerAccountForAssetCmd,
  CreateLedgerAccountsForPeerCmd,
  CreateLedgerCmd,
  IPalPeerAccounts,
  LedgerCommand,
  PostTransactionCmd
} from 'pal-domain-lib';
import {
  CreateLedgerAccountForAssetCmdSerde,
  CreateLedgerAccountsForPeerCmdSerde,
  CreateLedgerCmdSerde,
  LedgerAccountsCreatedStateEventSerde,
  LedgerCreatedStateEventSerde,
  LedgerSnapshotSerde,
  LedgerTransactionRecordedStateEventSerde,
  PostTransactionCmdSerde
} from 'pal-implementations-lib';
import { randomBytes } from 'node:crypto';

const INSTANCE_ID = `ES_LEDGER_POC_TEST__${crypto.randomUUID()}`;
// Message Consumer/Publisher
const KAFKA_URL =
  process.env['KAFKA_URL'] || '127.0.0.1:19092,127.0.0.1:29092,127.0.0.1:39092';

// kafka common options
const kafkaProducerCommonOptions: KafkaProducerOptions = {
  compressionCodec: KafkaProducerCompressionCodecs.GZIP,
  queueBufferingMaxMessages: 500_000,
  messageMaxBytes: 20971520 * 2
};
// const kafkaConsumerCommonOptions:KafkaConsumerOptions = {};

const ASSET_CODE = 'EUR';
const ASSET_SYSTEM_ACC_ID = 'system';
const PEER_ID = 'peer';

let producer: IMessageProducer;

const peerAccounts: IPalPeerAccounts = {
  peerLiquidityAccId: 'peerLiquidityAccId',
  peerClearingAccId: 'peerClearingAccId',
  aseLiquidityAccId: 'aseLiquidityAccId',
  aseClearingAccId: 'aseClearingAccId',
  suspenseAccId: 'suspenseAccId'
};

const CREATE_LEDGER_AND_ACCOUNTS =
  (process.env['CREATE_LEDGER_AND_ACCOUNTS'] &&
    process.env['CREATE_LEDGER_AND_ACCOUNTS'].toUpperCase() === 'TRUE') ||
  false;
const TRANSACTION_COUNT = process.env['TRANSACTION_COUNT']
  ? parseInt(process.env['TRANSACTION_COUNT'])
  : 10;

const TEST_TYPE_LOW_LEVEL = 'lowlevel';
const TEST_TYPE_HIGH_LEVEL = 'highlevel';
const TEST_TYPE =
  process.env['TEST_TYPE'] &&
  process.env['TEST_TYPE'].toUpperCase() === TEST_TYPE_HIGH_LEVEL
    ? TEST_TYPE_HIGH_LEVEL
    : TEST_TYPE_LOW_LEVEL;

const logger = new ConsoleLogger();

/*
 * NOTE: this should me moved to an integration test package
 * keeping here for now
 * */

function getRandomPair(array: string[]): [string, string] | undefined {
  if (array.length < 2) return undefined;

  const firstIndex = Math.floor(Math.random() * array.length);
  let secondIndex = Math.floor(Math.random() * array.length);

  while (secondIndex === firstIndex) {
    secondIndex = Math.floor(Math.random() * array.length);
  }
  return [array[firstIndex], array[secondIndex]];
}

async function setup() {
  MessageSerializationFactory.instance()
    // snapshots
    .register(new LedgerSnapshotSerde())
    // state events
    .register(new LedgerCreatedStateEventSerde())
    .register(new LedgerAccountsCreatedStateEventSerde())
    .register(new LedgerTransactionRecordedStateEventSerde())
    // commands
    .register(new CreateLedgerCmdSerde())
    .register(new PostTransactionCmdSerde())
    .register(new CreateLedgerAccountForAssetCmdSerde())
    .register(new CreateLedgerAccountsForPeerCmdSerde());

  const kafkaBuilder = new KafkaBuilder()
    // .withLogger(logger)
    // .withSerializerFactory(MessageSerializationFactory.instance())
    .withBrokerList(KAFKA_URL)
    .withClientId(`${INSTANCE_ID}`);

  producer = kafkaBuilder.buildProducer(kafkaProducerCommonOptions);
  await producer.connect();

  const cmds: CommandMsg[] = [];

  if (CREATE_LEDGER_AND_ACCOUNTS) {
    const startTs = Date.now();
    cmds.push(...createLedgerAssetAndPeerAccounts());
    await producer.send(cmds);
    const endTs = Date.now();
    logger.debug(`Setup - Created ledger and accounts in ${endTs - startTs}ms`);
  } else {
    logger.debug(`Setup - Skipping ledger and accounts creation`);
  }
}

function createLedgerAssetAndPeerAccounts(): CommandMsg[] {
  const cmd1 = new CreateLedgerCmd({ id: ASSET_CODE });
  const cmd2 = new CreateLedgerAccountForAssetCmd(ASSET_CODE, {
    id: ASSET_SYSTEM_ACC_ID,
    assetCode: ASSET_CODE
  });
  const cmd3 = new CreateLedgerAccountsForPeerCmd(ASSET_CODE, {
    ...peerAccounts,
    assetCode: ASSET_CODE,
    peerId: PEER_ID
  });
  return [cmd1, cmd2, cmd3];
}

function getSimpleTransactionTestCommands(
  transactionIdPrefix: string
): LedgerCommand[] {
  const cmds: CommandMsg[] = [];

  for (let i = 0; i < TRANSACTION_COUNT; i++) {
    //let amount = "1"; //BigInt(Math.round(Math.random() * 1000));
    const amount = BigInt(Math.round(Math.random() * 1000)).toString();
    const [sender, receiver] = getRandomPair([
      peerAccounts.aseClearingAccId,
      peerAccounts.peerClearingAccId
    ]) || [peerAccounts.aseClearingAccId, peerAccounts.peerClearingAccId];

    cmds.push(
      new PostTransactionCmd(ASSET_CODE, {
        id: transactionIdPrefix + i.toString(),
        amount: amount,
        amountScale: 2,
        debitedAccountId: sender,
        creditedAccountId: receiver
      })
    );
  }

  return cmds;
}

function getHighLevelTransactionTestCommands(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  transactionIdPrefix: string
): LedgerCommand[] {
  const cmds: CommandMsg[] = [];

  /* for (let i = 0; i < TRANSACTION_COUNT; i++) {
    const amount = BigInt(Math.round(Math.random() * 1000)).toString();
    const [payer, payee] = getRandomPair([peerAccounts.aseClearingAccId, peerAccounts.peerClearingAccId]);

  // TODO
    const a = transactionIdPrefix;
  }*/

  return cmds;
}

async function main() {
  await setup();

  const cmds: CommandMsg[] = [];

  if (CREATE_LEDGER_AND_ACCOUNTS) {
    cmds.push(...createLedgerAssetAndPeerAccounts());
  }

  const transactionIdPrefix = `txn_${randomBytes(3).toString('hex')}_`;

  if (TEST_TYPE === TEST_TYPE_HIGH_LEVEL) {
    cmds.push(...getHighLevelTransactionTestCommands(transactionIdPrefix));
  } else if (TEST_TYPE === TEST_TYPE_LOW_LEVEL) {
    cmds.push(...getSimpleTransactionTestCommands(transactionIdPrefix));
  } else {
    throw new Error(`Invalid test type: ${TEST_TYPE}`);
  }

  const startTs = Date.now();
  await producer.send(cmds);

  logger.debug(
    `${cmds.length} transactions posted, publishing took: ${Date.now() - startTs} ms`
  );
}

main().then(() => {
  logger.debug('Done');
  process.exit(0);
});
