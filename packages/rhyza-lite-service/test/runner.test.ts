import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ILogger } from 'common-types-lib';
import { LiteRunner, type LiteServiceEntry } from '../src/runner';

function createLogger(): ILogger {
  const noop = () => {};
  const logger: ILogger = {
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    child: () => logger,
    setLogLevel: noop,
    isTraceEnabled: () => false,
    isDebugEnabled: () => false
  } as unknown as ILogger;
  return logger;
}

interface EntryOptions {
  failStart?: Error;
  failStop?: Error;
  startGate?: Promise<void>;
}

function createEntry(
  name: string,
  calls: string[],
  options: EntryOptions = {}
): LiteServiceEntry {
  return {
    name,
    async start() {
      calls.push(`start:${name}`);
      if (options.startGate) await options.startGate;
      if (options.failStart) throw options.failStart;
    },
    async stop() {
      calls.push(`stop:${name}`);
      if (options.failStop) throw options.failStop;
    }
  };
}

test('starts in order and stops in reverse', async () => {
  const calls: string[] = [];
  const runner = new LiteRunner(
    [createEntry('a', calls), createEntry('b', calls), createEntry('c', calls)],
    createLogger()
  );
  await runner.start();
  await runner.stop();
  assert.deepEqual(calls, [
    'start:a',
    'start:b',
    'start:c',
    'stop:c',
    'stop:b',
    'stop:a'
  ]);
});

test('start failure stops already started services in reverse and rethrows', async () => {
  const calls: string[] = [];
  const runner = new LiteRunner(
    [
      createEntry('a', calls),
      createEntry('b', calls, { failStart: new Error('boom') }),
      createEntry('c', calls)
    ],
    createLogger()
  );
  await assert.rejects(runner.start(), { message: 'boom' });
  assert.deepEqual(calls, ['start:a', 'start:b', 'stop:a']);
});

test('stop continues past a failing stop', async () => {
  const calls: string[] = [];
  const runner = new LiteRunner(
    [
      createEntry('a', calls),
      createEntry('b', calls, { failStop: new Error('nope') }),
      createEntry('c', calls)
    ],
    createLogger()
  );
  await runner.start();
  await runner.stop();
  assert.deepEqual(calls.slice(3), ['stop:c', 'stop:b', 'stop:a']);
});

test('stop during start prevents remaining services from starting', async () => {
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runner = new LiteRunner(
    [
      createEntry('a', calls),
      createEntry('b', calls, { startGate: gate }),
      createEntry('c', calls)
    ],
    createLogger()
  );
  const startPromise = runner.start();
  await new Promise((resolve) => setImmediate(resolve));
  const stopPromise = runner.stop();
  release();
  await startPromise;
  await stopPromise;
  assert.deepEqual(calls, ['start:a', 'start:b', 'stop:b', 'stop:a']);
});

test('stop during start does not reject when the in-flight start fails', async () => {
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runner = new LiteRunner(
    [
      createEntry('a', calls),
      createEntry('b', calls, { startGate: gate, failStart: new Error('late') })
    ],
    createLogger()
  );
  const startPromise = runner.start();
  await new Promise((resolve) => setImmediate(resolve));
  const stopPromise = runner.stop();
  release();
  await startPromise;
  await stopPromise;
  assert.deepEqual(calls, ['start:a', 'start:b', 'stop:a']);
});

test('second stop is a no-op', async () => {
  const calls: string[] = [];
  const runner = new LiteRunner([createEntry('a', calls)], createLogger());
  await runner.start();
  await runner.stop();
  await runner.stop();
  assert.deepEqual(calls, ['start:a', 'stop:a']);
});

test('concurrent stop calls do not double-stop', async () => {
  const calls: string[] = [];
  const runner = new LiteRunner([createEntry('a', calls)], createLogger());
  await runner.start();
  await Promise.all([runner.stop(), runner.stop()]);
  assert.deepEqual(calls, ['start:a', 'stop:a']);
});

test('startFailed is false after a clean start and stop', async () => {
  const runner = new LiteRunner([createEntry('a', [])], createLogger());
  await runner.start();
  await runner.stop();
  assert.equal(runner.startFailed, false);
});

test('startFailed is true when stop is called while a start failure drains', async () => {
  const calls: string[] = [];
  let releaseStop = () => {};
  let markDraining = () => {};
  const draining = new Promise<void>((resolve) => (markDraining = resolve));
  const stopGate = new Promise<void>((resolve) => (releaseStop = resolve));
  const gatedStop: LiteServiceEntry = {
    name: 'a',
    async start() {
      calls.push('start:a');
    },
    async stop() {
      calls.push('stop:a');
      markDraining();
      await stopGate;
    }
  };
  const runner = new LiteRunner(
    [gatedStop, createEntry('b', calls, { failStart: new Error('boom') })],
    createLogger()
  );
  const started = runner.start();
  await draining;
  const stopped = runner.stop();
  releaseStop();
  await stopped;
  await assert.rejects(started, { message: 'boom' });
  assert.equal(runner.startFailed, true);
  assert.deepEqual(calls, ['start:a', 'start:b', 'stop:a']);
});
