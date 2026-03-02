/*****
 Copyright © 2026 & Interledger Foundation
 ----------------------------------------------
 Contributors

 * Cyberbones Digital Solutions
 - Pedro Sousa Barreto <pedrosousabarreto@gmail.com>
 ******/

'use strict';
import { before, test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  AssetAggregate,
  IPalAssetRepository,
  IPalWalletAddressRepository,
  WalletAddressAggregate, WalletAddressAliasAggregate
} from '../src';
import {MockAssetRepo, MockWalletAddressAliasRepo, MockWalletRepo} from './mocks';

let assetAggregate: AssetAggregate;
let assetRepository: IPalAssetRepository;

let walletAggregate: WalletAddressAggregate;
let walletRepository: IPalWalletAddressRepository;

let walletAddressAliasAggregate: WalletAddressAliasAggregate;
let walletAddressAliasRepository: MockWalletAddressAliasRepo;

const ASSET_CODE = 'EUR';
const ASSET_SCALE = 2;

const ALIAS_PREFIX = 'domain.com';
const ALIAS_SUFFIX = 'pedrobarreto';
let createdWalletAddress = "123";

before(async () => {
  assetRepository = new MockAssetRepo();
  assetAggregate = new AssetAggregate(assetRepository);

  walletRepository = new MockWalletRepo();
  walletAggregate = new WalletAddressAggregate(walletRepository);

  walletAddressAliasRepository = new MockWalletAddressAliasRepo();
  walletAddressAliasAggregate = new WalletAddressAliasAggregate(walletAddressAliasRepository)
});

//region assets
test('pal domain - create asset', async () => {
  await assetAggregate.createAsset(
    ASSET_CODE,
    ASSET_SCALE,
    undefined,
    undefined
  );
});

test('pal domain - get asset', async () => {
  const asset = await assetAggregate.getAsset(ASSET_CODE);

  assert.ok(asset);
  assert.equal(asset.code, ASSET_CODE);
  assert.equal(asset.scale, ASSET_SCALE);
  assert.equal(asset.liquidityLowThreshold, null);
  assert.equal(asset.liquidityHighThreshold, null);
});

test('pal domain - created duplicate asset should fail', async () => {
  try {
    await assetAggregate.createAsset(
      ASSET_CODE,
      ASSET_SCALE,
      undefined,
      undefined
    );

    assert.fail();
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.ok(e.message.includes('already exists'));
  }
});

test('pal domain - get non existing asset should fail', async () => {
  const asset = await assetAggregate.getAsset('NON EXISTING');

  assert.ok(asset === null);
});
//endregion assets

//region wallet address
test('pal domain - create wallet address', async () => {

  const resp = await walletAggregate.createWalletAddress(
    createdWalletAddress,
    'Pedro Barreto',
    ASSET_CODE,
    ASSET_SCALE
  );
  assert.ok(resp);
});

test('pal domain - get wallet', async () => {
  const wallets = await walletAggregate.getWalletAddresses([createdWalletAddress]);

  assert.ok(wallets);
  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].id, createdWalletAddress);
  assert.equal(wallets[0].publicName, 'Pedro Barreto');
  assert.equal(wallets[0].assetCode, ASSET_CODE);
  assert.equal(wallets[0].assetScale, ASSET_SCALE);
  assert.equal(wallets[0].isActive, true);
});

test('pal domain - created duplicate wallet should fail', async () => {
  try {
    await walletAggregate.createWalletAddress(
      createdWalletAddress,
      'Pedro Barreto',
      ASSET_CODE,
      ASSET_SCALE
    );

    assert.fail();
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.ok(e.message.includes('already exists'));
  }
});

test('pal domain - get non existing wallet should fail', async () => {
  const wallets = await walletAggregate.getWalletAddresses(['NON EXISTING']);

  assert.ok(wallets.length === 0);
});
//endregion wallet address

//region wallet address alias
test('pal domain - create wallet address alias without prefix', async () => {
  await walletAddressAliasAggregate.createWalletAddressAlias(null, ALIAS_SUFFIX, createdWalletAddress);
  assert.ok(true);
});

test('pal domain - create wallet address alias with prefix', async () => {
  await walletAddressAliasAggregate.createWalletAddressAlias(ALIAS_PREFIX, ALIAS_SUFFIX, createdWalletAddress);
  assert.ok(true);
});

test('pal domain - resolve wallet address alias without prefix', async () => {
  const address = await walletAddressAliasAggregate.resolveWalletAddressId(null, ALIAS_SUFFIX);

  assert.ok(address);
  assert.equal(address, createdWalletAddress);
});
test('pal domain - resolve wallet address alias with prefix', async () => {
  const address = await walletAddressAliasAggregate.resolveWalletAddressId(ALIAS_PREFIX, ALIAS_SUFFIX);

  assert.ok(address);
  assert.equal(address, createdWalletAddress);
});

test('pal domain - resolve non existing wallet address alias with prefix should fail', async () => {
  const address = await walletAddressAliasAggregate.resolveWalletAddressId(ALIAS_PREFIX, "NON_EXISTING");

  assert.equal(address === null, true);
});

test('pal domain - resolve non existing wallet address alias without prefix should fail', async () => {
  const address = await walletAddressAliasAggregate.resolveWalletAddressId(null, "NON_EXISTING");

  assert.equal(address === null, true);
});

//endregion wallet address alias
