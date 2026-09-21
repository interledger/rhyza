import { HttpSignatureService } from './service';

HttpSignatureService.start().then(() => {
  console.log('HTTP signature service started');
});

async function handleShutdownSignal(signal: NodeJS.Signals): Promise<void> {
  console.info(`Service - ${signal} received - cleaning up...`);
  await HttpSignatureService.stop();
  process.exit();
}

process.on('SIGINT', handleShutdownSignal);
process.on('SIGTERM', handleShutdownSignal);

process.on('uncaughtException', (err: Error) => {
  console.error(err);
  process.exit(1);
});
