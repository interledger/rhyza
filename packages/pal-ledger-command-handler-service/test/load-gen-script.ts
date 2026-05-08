import {
  KafkaBuilder,
  KafkaProducerCompressionCodecs,
  KafkaProducerOptions,
  MessageSerializationFactory
} from 'implementations-lib';
import { CommandMsg, ConsoleLogger, IMessageProducer } from 'common-types-lib';
import {
  CreateLedgerAccountCmd,
  CreateLedgerCmd,
  PostTransactionCmd
} from 'pal-domain-lib';
import {
  CreateLedgerAccountCmdSerde,
  CreateLedgerAccountForAssetCmdSerde,
  CreateLedgerAccountForPeerCmdSerde,
  CreateLedgerCmdSerde,
  LedgerAccountCreatedStateEventSerde,
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

const assetCode = 'EUR';
const pedroAccId = 'pedro';
const elsaAccId = 'elsa';

let producer: IMessageProducer;

const CREATE_LEDGER_AND_ACCOUNTS =
  (process.env['CREATE_LEDGER_AND_ACCOUNTS'] &&
    process.env['CREATE_LEDGER_AND_ACCOUNTS'].toUpperCase() === 'TRUE') ||
  false;
const TRANSACTION_COUNT = process.env['TRANSACTION_COUNT']
  ? parseInt(process.env['TRANSACTION_COUNT'])
  : 10;

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

function createLedgerAndAccounts(): CommandMsg[] {
  const cmd1 = new CreateLedgerCmd({ id: 'EUR' });
  const cmd2 = new CreateLedgerAccountCmd(assetCode, {
    id: pedroAccId,
    assetCode: assetCode,
    assetDisplayScale: 2,
    name: 'EUR acc pedro'
  });
  const cmd3 = new CreateLedgerAccountCmd(assetCode, {
    id: elsaAccId,
    assetCode: assetCode,
    assetDisplayScale: 2,
    name: 'EUR acc elsa'
  });
  return [cmd1, cmd2, cmd3];
}

async function main() {
  MessageSerializationFactory.instance()
    // snapshots
    .register(new LedgerSnapshotSerde())
    // state events
    .register(new LedgerCreatedStateEventSerde())
    .register(new LedgerAccountCreatedStateEventSerde())
    .register(new LedgerTransactionRecordedStateEventSerde())
    // commands
    .register(new CreateLedgerCmdSerde())
    .register(new CreateLedgerAccountCmdSerde())
    .register(new PostTransactionCmdSerde())
    .register(new CreateLedgerAccountCmdSerde())
    .register(new CreateLedgerAccountForAssetCmdSerde())
    .register(new CreateLedgerAccountForPeerCmdSerde());

  const kafkaBuilder = new KafkaBuilder()
    // .withLogger(logger)
    // .withSerializerFactory(MessageSerializationFactory.instance())
    .withBrokerList(KAFKA_URL)
    .withClientId(`${INSTANCE_ID}`);

  producer = kafkaBuilder.buildProducer(kafkaProducerCommonOptions);

  await producer.connect();

  const cmds: CommandMsg[] = [];

  if (CREATE_LEDGER_AND_ACCOUNTS) {
    cmds.push(...createLedgerAndAccounts());
  }

  const transactionIdPrefix = `txn_${randomBytes(3).toString('hex')}_`;

  for (let i = 0; i < TRANSACTION_COUNT; i++) {
    //let amount = "1"; //BigInt(Math.round(Math.random() * 1000));
    const amount = BigInt(Math.round(Math.random() * 1000)).toString();
    const [sender, receiver] = getRandomPair([pedroAccId, elsaAccId]) || [
      pedroAccId,
      elsaAccId
    ];

    cmds.push(
      new PostTransactionCmd(assetCode, {
        id: transactionIdPrefix + i.toString(),
        amount: amount,
        amountScale: 2,
        debitedAccountId: sender,
        creditedAccountId: receiver
      })
    );
  }

  const startTs = Date.now();

  await producer.send(cmds);

  logger.debug(
    `Transactions posted, publishing took: ${Date.now() - startTs} ms`
  );
}

main().then(() => {
  logger.debug('Done');
  process.exit(0);
});
