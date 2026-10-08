import { ILoadTestStats, LoadTests } from './load';
import { ISettingsData } from './common';
import { randomBytes } from 'node:crypto';
import process from 'process';
import { format } from 'node:util';
import crypto from 'crypto';
import { ILogger, NullLogger } from 'common-types-lib';
import { OpenTelemetryService } from 'implementations-lib';
import { PalClient } from 'pal-client-lib';

const CREATE_LEDGER_AND_ACCOUNTS =
  (process.env['CREATE_LEDGER_AND_ACCOUNTS'] &&
    process.env['CREATE_LEDGER_AND_ACCOUNTS'].toUpperCase() === 'TRUE') ||
  false;
const PAL_API_URL = process.env['PAL_API_URL'] || '127.0.0.1:50051';
const TRANSACTION_COUNT = process.env['TRANSACTION_COUNT']
  ? parseInt(process.env['TRANSACTION_COUNT'])
  : 10;
const KAFKA_URL =
  process.env['KAFKA_URL'] || '127.0.0.1:19092,127.0.0.1:29092,127.0.0.1:39092';

const BC_NAME = 'PAL';
const APP_NAME = `${BC_NAME}_LEDGER_LOAD_TEST`;
const APP_VERSION = '0.0.1';
const INSTANCE_ID = `${APP_NAME}_${crypto.randomUUID()}`;

const OPEN_TELEMETRY_COLLECTOR_URL =
  process.env['OPEN_TELEMETRY_COLLECTOR_URL'] || 'http://127.0.0.1:4317';

const logger: ILogger = new NullLogger();

OpenTelemetryService.Start(
  BC_NAME,
  APP_NAME,
  APP_VERSION,
  INSTANCE_ID,
  logger,
  OPEN_TELEMETRY_COLLECTOR_URL
);

const settingsData: ISettingsData = {
  testIdPrefix: `${randomBytes(3).toString('hex')}_`,
  kafkaUrl: KAFKA_URL,
  assetCode: 'EUR',
  peerId: 'peerOne',
  disableConsoleLog: true
};

async function main() {
  await loadTests.init();

  if (CREATE_LEDGER_AND_ACCOUNTS) {
    await loadTests.setupLedger();
  }

  loadTests.on('statsAvailable', (stats: ILoadTestStats) => {
    console.log(format('%j', stats));
  });
  loadTests.on('logAvailable', (logLine: string) => {
    console.log(`${logLine}`);
  });

  await loadTests.start();
}

const apiClient = new PalClient(PAL_API_URL);
const loadTests = new LoadTests(
  settingsData,
  apiClient,
  TRANSACTION_COUNT,
  logger,
  INSTANCE_ID,
  OpenTelemetryService.getInstance()
);

main().then(() => {
  console.debug('Done');
  process.exit(0);
});

/**
 * process termination and cleanup
 */

async function _handle_int_and_term_signals(
  signal: NodeJS.Signals
): Promise<void> {
  console.info(`LoadTests - ${signal} received - cleaning up...`);
  let cleanExit = false;
  setTimeout(() => {
    // eslint-disable-next-line
    cleanExit || process.exit(99);
  }, 5000);

  // call graceful stop routine
  await loadTests.stop();

  cleanExit = true;
  process.exit();
}

//catches ctrl+c event
process.on('SIGINT', _handle_int_and_term_signals);
//catches program termination event
process.on('SIGTERM', _handle_int_and_term_signals);

//do something when app is closing
process.on('exit', async () => {
  console.info('Microservice - exiting...');
});
process.on('uncaughtException', (err: Error) => {
  console.error(err);
  console.log('UncaughtException - EXITING...');
  process.exit(999);
});
