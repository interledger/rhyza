import { PaymentsApiService } from './service';
import process from 'process';

void PaymentsApiService.start().then(() => {
  console.log(`${PaymentsApiService.constructor.name} start complete`);
});

/**
 * process termination and cleanup
 */

async function _handle_int_and_term_signals(
  signal: NodeJS.Signals
): Promise<void> {
  console.info(`Service - ${signal} received - cleaning up...`);
  let cleanExit = false;
  setTimeout(() => {
    // eslint-disable-next-line
    cleanExit || process.exit(99);
  }, 5000);

  await PaymentsApiService.stop();

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
