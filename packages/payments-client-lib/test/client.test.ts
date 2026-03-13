'use strict';

import { after, before, describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { PaymentsClient } from '../src';
import { PalClient } from 'pal-client-lib';

// these are integration tests ... do i want unti? whats pal clietn doing?

const PAL_GRPC_URL = process.env['PAL_GRPC_URL'] || '0.0.0.0:50051';
const PAYMENTS_GRPC_URL = process.env['PAYMENTS_GRPC_URL'] || '0.0.0.0:50052';

const ASSET_CODE = 'USD';
const ASSET_SCALE = 2;
const WALLET_ADDRESS = 'payments-client-test.com/receiver';
const PUBLIC_NAME = 'Test Receiver';

let palClient: PalClient;
let paymentsClient: PaymentsClient;
let receiverWalletAddressId: string;

before(async () => {
  palClient = new PalClient(PAL_GRPC_URL);
  await palClient.init();

  // Ensure asset exists
  try {
    await palClient.createAsset(ASSET_CODE, ASSET_SCALE, undefined, undefined);
  } catch {
    // already exists — fine for reruns
  }

  // Ensure wallet address exists
  try {
    await palClient.createWalletAddress(
      WALLET_ADDRESS,
      PUBLIC_NAME,
      ASSET_CODE
    );
  } catch {
    // already exists — fine for reruns
  }

  // Resolve the internal UUID for use in payment commands
  const [prefix, suffix] = WALLET_ADDRESS.split('/') as [string, string];
  const alias = await palClient.ResolveWalletAddressAlias(prefix, suffix);
  assert.ok(alias, 'wallet address alias must resolve');
  receiverWalletAddressId = alias.walletAddressId;

  paymentsClient = new PaymentsClient(PAYMENTS_GRPC_URL);
  await paymentsClient.init();
});

after(async () => {
  await paymentsClient.disconnect();
  await palClient.disconnect();
});

describe('Payments Client', () => {
  test('create incoming payment (required fields only)', async () => {
    const id = randomUUID();
    const result = await paymentsClient.createIncomingPayment(
      id,
      receiverWalletAddressId,
      WALLET_ADDRESS
    );

    assert.ok(result);
    assert.equal(result.id, id);
  });

  test('create incoming payment (all fields)', async () => {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 5).toISOString(); // 5 minutes
    const result = await paymentsClient.createIncomingPayment(
      id,
      receiverWalletAddressId,
      WALLET_ADDRESS,
      100,
      expiresAt
    );

    assert.ok(result);
    assert.equal(result.id, id);
  });

  test('duplicate id is rejected', async () => {
    const id = randomUUID();
    await paymentsClient.createIncomingPayment(
      id,
      receiverWalletAddressId,
      WALLET_ADDRESS
    );

    try {
      await paymentsClient.createIncomingPayment(
        id,
        receiverWalletAddressId,
        WALLET_ADDRESS
      );
      assert.fail('expected error for duplicate id');
    } catch (e) {
      assert.ok(e instanceof Error);
    }
  });

  test('invalid uuid is rejected immediately', async () => {
    try {
      await paymentsClient.createIncomingPayment(
        'not-a-uuid',
        receiverWalletAddressId,
        WALLET_ADDRESS
      );
      assert.fail('expected error for invalid uuid');
    } catch (e) {
      assert.ok(e instanceof Error);
    }
  });

  test('unknown wallet address id is rejected', async () => {
    try {
      await paymentsClient.createIncomingPayment(
        randomUUID(),
        randomUUID(), // nonexistent wallet address id
        WALLET_ADDRESS
      );
      assert.fail('expected error for unknown wallet address');
    } catch (e) {
      assert.ok(e instanceof Error);
    }
  });
});
