import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { IRawMessageSerializer } from 'implementations-lib';
import { registerPalSerdes } from '../src/pal-serdes';

const PAL_SERVICES = [
  'pal-api-service',
  'pal-event-handler-service',
  'pal-ledger-command-handler-service'
];

function collectRegistered(): IRawMessageSerializer[] {
  const serdes: IRawMessageSerializer[] = [];
  registerPalSerdes({
    register(serde) {
      serdes.push(serde);
      return this;
    }
  });
  return serdes;
}

test('registerPalSerdes registers the 15 ledger serdes once each', () => {
  const names = collectRegistered().map((s) => `${s.msgType}:${s.msgName}`);
  assert.equal(names.length, 15);
  assert.equal(new Set(names).size, 15);
});

test('registerPalSerdes covers everything the PAL services register', () => {
  const registered = new Set(
    collectRegistered().map((s) => s.constructor.name)
  );
  const expected = new Set<string>();
  for (const svc of PAL_SERVICES) {
    const source = readFileSync(
      path.join(__dirname, '..', '..', svc, 'src', 'service.ts'),
      'utf8'
    );
    for (const match of source.matchAll(/\.register\(new (\w+Serde)\(\)\)/g)) {
      expected.add(match[1]);
    }
  }
  // guards against the regex silently matching nothing
  assert.equal(expected.size, 15);
  for (const name of expected) {
    assert.ok(registered.has(name), `${name} is not registered`);
  }
});
