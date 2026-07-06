import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ILogger } from 'common-types-lib';
import { PinoLogger } from '../src/logger';
import crypto from 'crypto';

const BC_NAME = 'TEST';
const APP_NAME = `${BC_NAME}_SCRIPT`;
const INSTANCE_ID = `${APP_NAME}_${crypto.randomUUID()}`;

let logger: ILogger;

test('Logger - create PinoLogger', async () => {
  logger = new PinoLogger({
    bcName: BC_NAME,
    appName: APP_NAME,
    instanceId: INSTANCE_ID
  });

  assert.ok(logger);
  logger.trace('test trace');
  logger.debug('test debug');
  logger.info('test info');
  logger.warn('test warn');
  logger.error(new Error('error message'), 'test error');
});

test('Logger - PinoLogger outputs', async () => {
  assert.ok(logger);
  logger.trace('test trace');
  logger.debug('test debug');
  logger.info('test info');
  logger.warn('test warn');
  logger.error(new Error('error message'), 'test error');
});

test('Logger - create PinoLogger child', async () => {
  const childLogger = logger.child('child');

  assert.ok(logger);
  childLogger.trace('test trace');
  childLogger.debug('test debug');
  childLogger.info('test info');
  childLogger.warn('test warn');
  childLogger.error(new Error('error message'), 'test error');
});
