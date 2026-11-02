import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  assertValidWalletAddressPathName,
  pathNameFromWalletAddress
} from '../src/utils';

test('pathNameFromWalletAddress returns a bare pathName unchanged', () => {
  assert.equal(pathNameFromWalletAddress('alice'), 'alice');
});

test('pathNameFromWalletAddress extracts pathName from a full URL', () => {
  assert.equal(pathNameFromWalletAddress('https://wallet.com/alice'), 'alice');
});

test('pathNameFromWalletAddress extracts pathName from a host without a TLD', () => {
  assert.equal(
    pathNameFromWalletAddress(
      'http://open-payments-resource-service:3002/alice'
    ),
    'alice'
  );
});

test('pathNameFromWalletAddress extracts pathName from host/path without protocol', () => {
  assert.equal(pathNameFromWalletAddress('wallet.com/alice'), 'alice');
});

test('assertValidWalletAddressPathName accepts a bare pathName', () => {
  assert.doesNotThrow(() => assertValidWalletAddressPathName('alice'));
});

test('assertValidWalletAddressPathName rejects a full URL', () => {
  assert.throws(
    () => assertValidWalletAddressPathName('https://wallet.com/alice'),
    /pathName/
  );
});

test('assertValidWalletAddressPathName rejects a slash', () => {
  assert.throws(
    () => assertValidWalletAddressPathName('wallet.com/alice'),
    /pathName/
  );
});
