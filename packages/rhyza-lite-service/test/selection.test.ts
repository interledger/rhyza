import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectServices } from '../src/selection';
import { SERVICE_START_ORDER } from '../src/service-names';

test('undefined selects every service in start order', () => {
  assert.deepEqual(selectServices(undefined), [...SERVICE_START_ORDER]);
});
test('empty or blank string selects every service', () => {
  assert.deepEqual(selectServices(''), [...SERVICE_START_ORDER]);
  assert.deepEqual(selectServices('  , '), [...SERVICE_START_ORDER]);
});
test('explicit list is returned in start order, trimmed and deduplicated', () => {
  assert.deepEqual(
    selectServices(' ilp-connector-service ,pal-api-service,pal-api-service'),
    ['pal-api-service', 'ilp-connector-service']
  );
});
test('unknown name throws and names it', () => {
  assert.throws(() => selectServices('pal-api-service,pal-apiservice'), {
    message: 'unknown service in RHYZA_SERVICES: "pal-apiservice"'
  });
});
test('start order has all 20 services, no duplicates', () => {
  assert.equal(SERVICE_START_ORDER.length, 20);
  assert.equal(new Set(SERVICE_START_ORDER).size, 20);
});
test('ase-mock-service is not part of lite', () => {
  assert.throws(() => selectServices('ase-mock-service'), {
    message: 'unknown service in RHYZA_SERVICES: "ase-mock-service"'
  });
});
