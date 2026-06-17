import { MockWebhookIntegrationService } from './service';

MockWebhookIntegrationService.start().then(() => {
  console.log('Mock webhook integration service started');
});

async function _handle_int_and_term_signals(
  signal: NodeJS.Signals
): Promise<void> {
  console.info(`Service - ${signal} received - cleaning up...`);
  let cleanExit = false;
  setTimeout(() => {
    // eslint-disable-next-line
    cleanExit || process.exit(99);
  }, 5000);

  await MockWebhookIntegrationService.stop();

  cleanExit = true;
  process.exit();
}

process.on('SIGINT', _handle_int_and_term_signals);
process.on('SIGTERM', _handle_int_and_term_signals);

process.on('exit', async () => {
  console.info('Microservice - exiting...');
});
process.on('uncaughtException', (err: Error) => {
  console.error(err);
  console.log('UncaughtException - EXITING...');
  process.exit(999);
});
