'use strict';

import crypto from 'crypto';
import { join } from 'path';
import process from 'process';
import {
  KafkaBuilder,
  MessageSerializationFactory,
  OpenTelemetryService,
  PinoLogger
} from 'implementations-lib';
import { registerPalSerdes } from './pal-serdes';
import { buildServiceEntries } from './registry';
import { LiteRunner } from './runner';
import { selectServices } from './selection';
import { ensureTopics } from './topics';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const packageJson = require(join(__dirname, '..', 'package.json'));

const BC_NAME = 'LITE';
const APP_NAME = 'RHYZA_LITE_SVC';
const APP_VERSION = packageJson.version || '0.0.0';
const INSTANCE_ID = `${APP_NAME}_${crypto.randomUUID()}`;

const KAFKA_URL = process.env['KAFKA_URL'] || 'localhost:9092';
// same default as the PAL services
const OPEN_TELEMETRY_COLLECTOR_URL =
  process.env['OPEN_TELEMETRY_COLLECTOR_URL'] || 'http://127.0.0.1:4317';

const FORCE_EXIT_TIMEOUT_MS = 5000;

const logger = new PinoLogger({
  bcName: BC_NAME,
  appName: APP_NAME,
  instanceId: INSTANCE_ID
});

let runner: LiteRunner | undefined;
let stopRequested = false;

async function main(): Promise<void> {
  const selected = selectServices(process.env['RHYZA_SERVICES']);

  OpenTelemetryService.Start(
    BC_NAME,
    APP_NAME,
    APP_VERSION,
    INSTANCE_ID,
    logger,
    OPEN_TELEMETRY_COLLECTOR_URL
  );
  const telemetry = OpenTelemetryService.getInstance();

  const serializationFactory = MessageSerializationFactory.instance();
  registerPalSerdes(serializationFactory);
  serializationFactory.setTelemetry(telemetry);

  // created before the topic step so a signal during it still goes through stop()
  runner = new LiteRunner(
    buildServiceEntries({ serializationFactory, telemetry }).filter((entry) =>
      selected.includes(entry.name)
    ),
    logger
  );

  await ensureTopics(
    new KafkaBuilder()
      .withLogger(logger.child('kafka'))
      .withBrokerList(KAFKA_URL)
      .withClientId(INSTANCE_ID)
      .withSerializerFactory(serializationFactory)
      .buildAdmin(),
    logger
  );
  if (stopRequested) return;

  // resolves without starting everything when stop() is called mid-start
  await runner.start();
  if (stopRequested) return;

  console.log('Rhyza lite start complete');
}

async function handleSignal(signal: NodeJS.Signals): Promise<void> {
  if (stopRequested) return;
  stopRequested = true;
  console.info(`Rhyza lite - ${signal} received - cleaning up...`);
  // armed before awaiting stop(), which waits for any in-flight service start
  setTimeout(() => process.exit(99), FORCE_EXIT_TIMEOUT_MS);
  await runner?.stop();
  // a signal during the teardown after a start failure must not turn it into exit 0
  process.exit(runner?.startFailed ? 1 : 0);
}

process.on('SIGINT', handleSignal);
process.on('SIGTERM', handleSignal);

process.on('exit', () => {
  console.info('Rhyza lite - exiting...');
});
process.on('uncaughtException', (err: Error) => {
  console.error(err);
  console.log('UncaughtException - EXITING...');
  process.exit(999);
});

main().catch((err) => {
  // the signal handler owns shutdown once a stop was requested
  if (stopRequested) return;
  logger.error({ err }, 'Rhyza lite failed to start');
  process.exit(1);
});
