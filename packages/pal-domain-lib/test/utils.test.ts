import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  amountFromBigIntOfSize,
  amountToBigIntOfSize
} from '../src/liquidity/utils';
import { LedgerPrecisionLossError } from '../src/liquidity/errors';

test('PAL Ledger - amount conversion - from string to bigint', async () => {
  let resp = amountToBigIntOfSize('123', 2, 2);
  assert.equal(resp, 123n);
  resp = amountToBigIntOfSize('-123', 2, 2);
  assert.equal(resp, -123n);

  resp = amountToBigIntOfSize('123', 2, 4);
  assert.equal(resp, 12300n);
  resp = amountToBigIntOfSize('-123', 2, 4);
  assert.equal(resp, -12300n);

  resp = amountToBigIntOfSize('123', 2, 10);
  assert.equal(resp, 12300000000n);

  try {
    assert.equal(amountToBigIntOfSize('12', 3, 3), 12n);
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof LedgerPrecisionLossError);
  }

  try {
    assert.equal(amountToBigIntOfSize('123', 2, 1), 123n);
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof LedgerPrecisionLossError);
  }

  try {
    assert.equal(amountToBigIntOfSize('123', 4, 2), 12300n);
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof LedgerPrecisionLossError);
  }

  try {
    resp = amountToBigIntOfSize('123', 4, 4);
    assert.equal(resp, 12300n);
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof LedgerPrecisionLossError);
  }

  try {
    assert.equal(amountToBigIntOfSize('12.34', 2, 2), 123n);
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof Error);
  }

  try {
    assert.equal(amountToBigIntOfSize('a123', 2, 2), 123n);
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof Error);
  }
});

test('PAL Ledger - amount conversion - from bigint to string', async () => {
  // same source and target scales
  let resp = amountFromBigIntOfSize(123n, 2, 2);
  assert.equal(resp, '123');
  resp = amountFromBigIntOfSize(-123n, 2, 2);
  assert.equal(resp, '-123');

  // source scale smaller than target scale
  resp = amountFromBigIntOfSize(123n, 2, 3);
  assert.equal(resp, '1230');
  resp = amountFromBigIntOfSize(-123n, 2, 3);
  assert.equal(resp, '-1230');

  resp = amountFromBigIntOfSize(10n, 2, 4);
  assert.equal(resp, '1000');
  resp = amountFromBigIntOfSize(-10n, 2, 4);
  assert.equal(resp, '-1000');

  // source scale bigger than target scale
  resp = amountFromBigIntOfSize(12300n, 4, 2);
  assert.equal(resp, '123');
  resp = amountFromBigIntOfSize(-12300n, 4, 2);
  assert.equal(resp, '-123');

  resp = amountFromBigIntOfSize(100n, 4, 2);
  assert.equal(resp, '1');
  resp = amountFromBigIntOfSize(-100n, 4, 2);
  assert.equal(resp, '-1');

  resp = amountFromBigIntOfSize(12300000000n, 10, 2);
  assert.equal(resp, '123');
  resp = amountFromBigIntOfSize(-12300000000n, 10, 2);
  assert.equal(resp, '-123');

  try {
    amountFromBigIntOfSize(12n, 2, 0);
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof LedgerPrecisionLossError);
  }

  try {
    amountFromBigIntOfSize(10n, 4, 2);
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof LedgerPrecisionLossError);
  }

  try {
    amountFromBigIntOfSize(-10n, 4, 2);
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof LedgerPrecisionLossError);
  }

  try {
    amountFromBigIntOfSize(12300n, 4, 0);
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof LedgerPrecisionLossError);
  }

  try {
    amountFromBigIntOfSize(12300000000n, 11, 2);
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof LedgerPrecisionLossError);
  }
});
