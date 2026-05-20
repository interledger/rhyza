import { before, test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  AssetAggregate,
  CannotCreateDuplicateWalletAddressAliasError,
  CannotCreateDuplicateWalletAddressError,
  IPalAssetRepository,
  IPalWalletAddressRepository,
  WalletAddressAggregate
} from '../src';
import { MockMessageProducer, MockAssetRepo, MockWalletRepo } from './mocks';
import { ConsoleLogger, DomainEvent } from 'common-types-lib';
import {
  WalletAddressAliasCreatedEvent,
  WalletAddressCreatedEvent
} from 'pal-public-types-lib';

const logger = new ConsoleLogger();

const mockProducer = new MockMessageProducer();

let assetAggregate: AssetAggregate;
let assetRepository: IPalAssetRepository;

let walletAggregate: WalletAddressAggregate;
let walletRepository: IPalWalletAddressRepository;

const ASSET_CODE = 'EUR';
const ASSET_SCALE = 2;

const ALIAS_DOMAIN = 'domain.com';
const ALIAS_PATHNAME = 'pedrobarreto';
const PUBLIC_NAME = 'Pedro Barreto';

let createdWalletAddressInternalId: string;

before(async () => {
  assetRepository = new MockAssetRepo();
  assetAggregate = new AssetAggregate(assetRepository, logger);

  walletRepository = new MockWalletRepo();
  walletAggregate = new WalletAddressAggregate(
    walletRepository,
    logger
  );
});

//region assets
test('PAL Asset Domain - create asset', async () => {
  await assetAggregate.createAsset(
    ASSET_CODE,
    ASSET_SCALE,
    undefined,
    undefined
  );
});

test('PAL Asset Domain - get asset', async () => {
  const asset = await assetAggregate.getAsset(ASSET_CODE);

  assert.ok(asset);
  assert.equal(asset.code, ASSET_CODE);
  assert.equal(asset.scale, ASSET_SCALE);
  assert.equal(asset.liquidityLowThreshold, null);
  assert.equal(asset.liquidityHighThreshold, null);
});

test('PAL Asset Domain - created duplicate asset should fail', async () => {
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

test('PAL Asset Domain - get non existing asset should fail', async () => {
  const asset = await assetAggregate.getAsset('NON EXISTING');

  assert.ok(asset === null);
});
//endregion assets

//region wallet address
test('PAL WalletAddress Domain - create wallet address', async () => {
  createdWalletAddressInternalId = await walletAggregate.createWalletAddress(
    ALIAS_DOMAIN,
    ALIAS_PATHNAME,
    PUBLIC_NAME,
    ASSET_CODE,
    ASSET_SCALE
  );

  assert.ok(createdWalletAddressInternalId);

  const lastEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.ok(lastEvent);
  assert.equal(lastEvent.msgName, WalletAddressCreatedEvent.name);
  assert.equal(lastEvent.aggregateId, createdWalletAddressInternalId);
  assert.ok(lastEvent.payload);
  assert.equal(lastEvent.payload.id, createdWalletAddressInternalId);
  assert.equal(lastEvent.payload.domain, ALIAS_DOMAIN);
  assert.equal(lastEvent.payload.pathName, ALIAS_PATHNAME);
  assert.equal(lastEvent.payload.publicName, PUBLIC_NAME);
  assert.equal(lastEvent.payload.assetCode, ASSET_CODE);
  assert.equal(lastEvent.payload.assetScale, ASSET_SCALE);
  assert.equal(lastEvent.payload.isActive, true);
});

test('PAL WalletAddress Domain - get wallet address', async () => {
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

test('PAL WalletAddress Domain - created duplicate wallet address should fail', async () => {
  try {
    await walletAggregate.createWalletAddress(
      ALIAS_DOMAIN,
      ALIAS_PATHNAME,
      PUBLIC_NAME,
      ASSET_CODE,
      ASSET_SCALE
    );

    assert.fail();
  } catch (e) {
    assert.ok(e instanceof CannotCreateDuplicateWalletAddressError);
  }
});

test('PAL WalletAddress Domain - get non existing wallet address should fail', async () => {
  const wallets = await walletAggregate.getWalletAddresses(['NON EXISTING']);

  assert.ok(wallets.length === 0);
});

test('PAL WalletAddress Domain - alias should exist for created wallet address', async () => {
  const walletId = await walletAggregate.resolveWalletAddressAlias(
    ALIAS_DOMAIN,
    ALIAS_PATHNAME
  );

  assert.ok(walletId);
  assert.equal(walletId, createdWalletAddressInternalId);
});

test('PAL WalletAddress Domain - create wallet address alias without domain', async () => {
  await walletAggregate.createWalletAddressAlias(
    null,
    ALIAS_PATHNAME,
    createdWalletAddressInternalId
  );

  const lastEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.ok(lastEvent);
  assert.equal(lastEvent.msgName, WalletAddressAliasCreatedEvent.name);
  assert.equal(lastEvent.aggregateId, createdWalletAddressInternalId);
  assert.ok(lastEvent.payload);
  assert.equal(lastEvent.payload.walletId, createdWalletAddressInternalId);
  assert.equal(lastEvent.payload.domain, null);
  assert.equal(lastEvent.payload.pathName, ALIAS_PATHNAME);
});

test('PAL WalletAddress Domain - create wallet address alias with domain', async () => {
  // Must use another domain as the create wallet address test
  // above automatically creates the alias with domain
  await walletAggregate.createWalletAddressAlias(
    'otherdomain.com',
    ALIAS_PATHNAME,
    createdWalletAddressInternalId
  );

  const lastEvent = mockProducer.messages[
    mockProducer.messages.length - 1
  ] as DomainEvent;
  assert.ok(lastEvent);
  assert.equal(lastEvent.msgName, WalletAddressAliasCreatedEvent.name);
  assert.equal(lastEvent.aggregateId, createdWalletAddressInternalId);
  assert.ok(lastEvent.payload);
  assert.equal(lastEvent.payload.walletId, createdWalletAddressInternalId);
  assert.equal(lastEvent.payload.domain, 'otherdomain.com');
  assert.equal(lastEvent.payload.pathName, ALIAS_PATHNAME);
});

test('PAL WalletAddress Domain - create wallet address with invalid wallet id should fail', async () => {
  try {
    await walletAggregate.createWalletAddressAlias(
      ALIAS_DOMAIN,
      ALIAS_PATHNAME,
      'invalid wallet id'
    );
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof CannotCreateDuplicateWalletAddressAliasError);
  }
});

test('PAL WalletAddress Domain - create alias that exists in another wallet address should fail', async () => {
  try {
    const newWalletId = await walletAggregate.createWalletAddress(
      ALIAS_DOMAIN,
      ALIAS_PATHNAME + '_other',
      PUBLIC_NAME + '_other',
      ASSET_CODE,
      ASSET_SCALE
    );

    await walletAggregate.createWalletAddressAlias(
      ALIAS_DOMAIN,
      ALIAS_PATHNAME,
      newWalletId
    );
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof CannotCreateDuplicateWalletAddressAliasError);
  }
});

test('PAL WalletAddress Domain - resolve wallet address alias without domain', async () => {
  const walletId = await walletAggregate.resolveWalletAddressAlias(
    null,
    ALIAS_PATHNAME
  );

  assert.ok(walletId);
  assert.equal(walletId, createdWalletAddressInternalId);
});

test('PAL WalletAddress Domain - resolve wallet address alias with domain', async () => {
  const walletId = await walletAggregate.resolveWalletAddressAlias(
    ALIAS_DOMAIN,
    ALIAS_PATHNAME
  );

  assert.ok(walletId);
  assert.equal(walletId, createdWalletAddressInternalId);
});

test('PAL WalletAddress Domain - resolve non existing wallet address alias with domain should fail', async () => {
  const walletId = await walletAggregate.resolveWalletAddressAlias(
    ALIAS_DOMAIN,
    'NON_EXISTING'
  );

  assert.equal(walletId === null, true);
});

test('PAL WalletAddress Domain - resolve non existing wallet address alias without domain should fail', async () => {
  const walletId = await walletAggregate.resolveWalletAddressAlias(
    null,
    'NON_EXISTING'
  );

  assert.equal(walletId === null, true);
});

//endregion wallet address alias
