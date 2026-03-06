/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';

import { after, before, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { PalClient } from '../src';

let client: PalClient;

const ASSET_CODE = 'EUR';
const ASSET_SCALE = 2;

const ALIAS_PREFIX = 'domain.com';
const ALIAS_SUFFIX = 'pedrobarreto';
const WALLET_ADDRESS = `${ALIAS_PREFIX}/${ALIAS_SUFFIX}`;
const PUBLIC_NAME = 'Pedro Barreto';

let createdWalletAddressId: string;

before(async () => {
  client = new PalClient('0.0.0.0:50051');
  await client.init();
});

/*
 * Asset tests
 * */

test('pal client - create asset', async () => {
  await client.createAsset(ASSET_CODE, ASSET_SCALE, undefined, undefined);
});

test('pal client - get asset', async () => {
  const asset = await client.getAsset(ASSET_CODE);

  assert.ok(asset);
  assert.equal(asset.code, ASSET_CODE);
  assert.equal(asset.scale, ASSET_SCALE);
  assert.equal(asset.liquidityLowThreshold, null);
  assert.equal(asset.liquidityHighThreshold, null);
});

test('pal client - created duplicate asset should fail', async () => {
  try {
    await client.createAsset(ASSET_CODE, ASSET_SCALE, undefined, undefined);

    assert.fail();
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.ok(e.message.includes('already exists'));
  }
});

test('pal client - get non existing asset should fail', async () => {
  const asset = await client.getAsset('NON EXISTING');

  assert.ok(asset === null);
});

/*
 * Wallet address tests
 * */

test('pal client - create wallet address', async () => {
  const createdWallet = await client.createWalletAddress(
    WALLET_ADDRESS,
    PUBLIC_NAME,
    ASSET_CODE
  );

  assert.ok(createdWallet);
  assert.equal(createdWallet.address, WALLET_ADDRESS);
  assert.equal(createdWallet.publicName, PUBLIC_NAME);
  assert.equal(createdWallet.assetCode, ASSET_CODE);
  assert.equal(createdWallet.assetScale, ASSET_SCALE);
  assert.equal(createdWallet.isActive, true);
});

// must run this here to resove / get the internal wallet address id
test('pal client - resolve created wallet address', async () => {
  const alias = await client.ResolveWalletAddressAlias(
    ALIAS_PREFIX,
    ALIAS_SUFFIX
  );

  createdWalletAddressId = alias.walletAddressId;

  assert.ok(alias);
  assert.ok(alias.walletAddressId);
  assert.equal(alias.prefix, ALIAS_PREFIX);
  assert.equal(alias.suffix, ALIAS_SUFFIX);
});

test('pal client - get wallet', async () => {
  const walletAddress = await client.getWalletAddresses([
    createdWalletAddressId
  ]);

  assert.ok(walletAddress);
  assert.equal(walletAddress.length, 1);
  assert.equal(walletAddress[0].id, createdWalletAddressId);
  assert.equal(walletAddress[0].publicName, PUBLIC_NAME);
  assert.equal(walletAddress[0].assetCode, ASSET_CODE);
  assert.equal(walletAddress[0].assetScale, ASSET_SCALE);
  assert.equal(walletAddress[0].isActive, true);
});

test('pal client - created duplicate wallet should fail', async () => {
  try {
    await client.createWalletAddress(WALLET_ADDRESS, PUBLIC_NAME, ASSET_CODE);

    assert.fail();
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.ok(e.message.includes('already exists'));
  }
});

test('pal client - get non existing wallet should fail', async () => {
  const walletAddress = await client.getWalletAddresses(['NON EXISTING']);

  assert.ok(walletAddress.length === 0);
});

after(async () => {
  await client.disconnect();
});

test('pal client - create wallet address alias without prefix', async () => {
  await client.createWalletAddressAlias(
    null,
    ALIAS_SUFFIX,
    createdWalletAddressId
  );
});
test('pal client - create wallet address alias with prefix', async () => {
  // Must use another prefix/domain as the create wallet address test
  // above automatically creates the alias with prefix
  await client.createWalletAddressAlias(
    'otherdomain.com',
    ALIAS_SUFFIX,
    createdWalletAddressId
  );
});

test('pal client - resolve wallet address alias without prefix', async () => {
  const alias = await client.ResolveWalletAddressAlias(null, ALIAS_SUFFIX);

  assert.ok(alias);
  assert.ok(alias.walletAddressId);
  assert.equal(alias.prefix, null);
  assert.equal(alias.suffix, ALIAS_SUFFIX);
});
test('pal client - resolve wallet address alias with prefix', async () => {
  const address = await client.ResolveWalletAddressAlias(
    ALIAS_PREFIX,
    ALIAS_SUFFIX
  );

  assert.ok(address);
  assert.equal(address.prefix, ALIAS_PREFIX);
  assert.equal(address.suffix, ALIAS_SUFFIX);
  assert.equal(address.walletAddressId, createdWalletAddressId);
});

test('pal client - resolve non existing wallet address alias with prefix should fail', async () => {
  const address = await client.ResolveWalletAddressAlias(
    ALIAS_PREFIX,
    'NON_EXISTING'
  );

  assert.equal(address === null, true);
});

test('pal client - resolve non existing wallet address alias without prefix should fail', async () => {
  const address = await client.ResolveWalletAddressAlias(null, 'NON_EXISTING');

  assert.equal(address === null, true);
});
