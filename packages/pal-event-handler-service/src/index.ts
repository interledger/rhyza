/*****

 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

import { PalLedgerEventHandlerService as Service } from './service';
import process from 'process';

void Service.start().then(() => {
  console.log(`${Service.constructor.name} start complete`);
});

/**
 * process termination and cleanup
 */

async function _handle_int_and_term_signals(
  signal: NodeJS.Signals
): Promise<void> {
  console.info(
    `${Service.constructor.name} - ${signal} received - cleaning up...`
  );
  let cleanExit = false;
  setTimeout(() => {
    // eslint-disable-next-line
    cleanExit || process.exit(99);
  }, 5000);

  // call graceful stop routine
  await Service.stop();

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
