import { IlpConnectorService } from './service';

void IlpConnectorService.start().then(() => {
  console.log('ILP connector service started');
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

  await IlpConnectorService.stop();

  cleanExit = true;
  process.exit();
}

process.on('SIGINT', _handle_int_and_term_signals);
process.on('SIGTERM', _handle_int_and_term_signals);

process.on('exit', () => {
  console.info('Microservice - exiting...');
});
process.on('uncaughtException', (err: Error) => {
  console.error(err);
  console.log('UncaughtException - EXITING...');
  process.exit(999);
});
