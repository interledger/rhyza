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
  WalletAddressAggregate,
  WalletAddressAliasAggregate,
  WalletDomainService
} from '../src';
import {
  MockAssetRepo,
  MockWalletAddressAliasRepo,
  MockWalletRepo
} from './mocks';

let assetAggregate: AssetAggregate;
let assetRepository: IPalAssetRepository;

let walletAggregate: WalletAddressAggregate;
let walletRepository: IPalWalletAddressRepository;

let walletAddressAliasAggregate: WalletAddressAliasAggregate;
let walletAddressAliasRepository: MockWalletAddressAliasRepo;

let walletDomainService: WalletDomainService;

const ASSET_CODE = 'EUR';
const ASSET_SCALE = 2;

const ALIAS_DOMAIN = 'domain.com';
const ALIAS_PATHNAME = 'pedrobarreto';
const PUBLIC_NAME = 'Pedro Barreto';

let createdWalletAddressInternalId: string;

before(async () => {
  assetRepository = new MockAssetRepo();
  assetAggregate = new AssetAggregate(assetRepository);

  walletRepository = new MockWalletRepo();
  walletAggregate = new WalletAddressAggregate(walletRepository);

  walletAddressAliasRepository = new MockWalletAddressAliasRepo();
  walletAddressAliasAggregate = new WalletAddressAliasAggregate(
    walletAddressAliasRepository
  );

  walletDomainService = new WalletDomainService(
    walletAggregate,
    walletAddressAliasAggregate
  );
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
  createdWalletAddressInternalId =
    await walletDomainService.createWalletAddress(
      ALIAS_DOMAIN,
      ALIAS_PATHNAME,
      PUBLIC_NAME,
      ASSET_CODE,
      ASSET_SCALE
    );

  assert.ok(createdWalletAddressInternalId);
});

test('pal domain - get wallet address', async () => {
  const wallets = await walletAggregate.getWalletAddresses([
    createdWalletAddressInternalId
  ]);

  assert.ok(wallets);
  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].id, createdWalletAddressInternalId);
  assert.equal(wallets[0].publicName, PUBLIC_NAME);
  assert.equal(wallets[0].assetCode, ASSET_CODE);
  assert.equal(wallets[0].assetScale, ASSET_SCALE);
  assert.equal(wallets[0].isActive, true);
});

test('pal domain - created duplicate wallet address should fail', async () => {
  try {
    await walletDomainService.createWalletAddress(
      ALIAS_DOMAIN,
      ALIAS_PATHNAME,
      PUBLIC_NAME,
      ASSET_CODE,
      ASSET_SCALE
    );

    assert.fail();
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.ok(e.message.includes('already exists'));
  }
});

test('pal domain - get non existing wallet address should fail', async () => {
  const wallets = await walletAggregate.getWalletAddresses(['NON EXISTING']);

  assert.ok(wallets.length === 0);
});
//endregion wallet address

//region wallet address alias
test('pal domain - alias should exist for created wallet address', async () => {
  const walletId = await walletAddressAliasAggregate.resolveWalletAddressAlias(
    ALIAS_DOMAIN,
    ALIAS_PATHNAME
  );

  assert.ok(walletId);
  assert.equal(walletId, createdWalletAddressInternalId);
});

test('pal domain - create wallet address alias without domain', async () => {
  await walletDomainService.createWalletAddressAlias(
    null,
    ALIAS_PATHNAME,
    createdWalletAddressInternalId
  );
  assert.ok(true);
});

test('pal domain - create wallet address alias with domain', async () => {
  // Must use another domain as the create wallet address test
  // above automatically creates the alias with domain
  await walletDomainService.createWalletAddressAlias(
    'otherdomain.com',
    ALIAS_PATHNAME,
    createdWalletAddressInternalId
  );
  assert.ok(true);
});

test('pal domain - create wallet address with invalid wallet id should fail', async () => {
  try {
    await walletDomainService.createWalletAddressAlias(
      ALIAS_DOMAIN,
      ALIAS_PATHNAME,
      'invalid wallet id'
    );
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.ok(e.message.includes('does not exist'));
  }
});

test('pal domain - resolve wallet address alias without domain', async () => {
  const walletId = await walletAddressAliasAggregate.resolveWalletAddressAlias(
    null,
    ALIAS_PATHNAME
  );

  assert.ok(walletId);
  assert.equal(walletId, createdWalletAddressInternalId);
});

test('pal domain - resolve wallet address alias with domain', async () => {
  const walletId = await walletAddressAliasAggregate.resolveWalletAddressAlias(
    ALIAS_DOMAIN,
    ALIAS_PATHNAME
  );

  assert.ok(walletId);
  assert.equal(walletId, createdWalletAddressInternalId);
});

test('pal domain - resolve non existing wallet address alias with domain should fail', async () => {
  const walletId = await walletAddressAliasAggregate.resolveWalletAddressAlias(
    ALIAS_DOMAIN,
    'NON_EXISTING'
  );

  assert.equal(walletId === null, true);
});

test('pal domain - resolve non existing wallet address alias without domain should fail', async () => {
  const walletId = await walletAddressAliasAggregate.resolveWalletAddressAlias(
    null,
    'NON_EXISTING'
  );

  assert.equal(walletId === null, true);
});

//endregion wallet address alias
