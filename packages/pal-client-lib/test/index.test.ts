import { after, before, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import * as assert from 'node:assert/strict';
import { PalClient, parseAddressToDomainAndPathName } from '../src';

let client: PalClient;
const testPrefix = `TEST-${randomBytes(3).toString('hex')}`;

// const assetCode = `USD`;
const ASSET_CODE = `${testPrefix}_EUR`;
const ASSET_SCALE = 2;

const PEER_ONE_ID = `${testPrefix}_peer1`;
const PEER_ONE_NAME = `${testPrefix} Peer One`;
const PEER_ONE_ILP_STATIC_ADDRESS = `${testPrefix}_peer1.static.address`;

const ALIAS_DOMAIN = `${testPrefix}_domain.com`;
const ALIAS_PATHNAME = `${testPrefix}_pedrobarreto`;
const PUBLIC_NAME = 'Pedro Barreto';

let createdWalletAddressId: string;
let createdAssetLedgerAccountId: string;

let createdPeerLiquidityAccountId: string;
let createdPeerClearingAccountId: string;

before(async () => {
  client = new PalClient('0.0.0.0:50051');
  await client.init();
});
after(async () => {
  await client.disconnect();
});

/*
 * Asset tests
 * */

test('pal client - create asset', async () => {
  await client.createAsset(ASSET_CODE, ASSET_SCALE, undefined, undefined);
  assert.ok(true);
});

test('pal client - created asset must exist', async () => {
  const asset = await client.getAsset(ASSET_CODE);

  assert.ok(asset);
  assert.equal(asset.code, ASSET_CODE);
  assert.equal(asset.scale, ASSET_SCALE);
  assert.equal(asset.liquidityLowThreshold, null);
  assert.equal(asset.liquidityHighThreshold, null);
  assert.ok(asset.ledgerAccountId);
  createdAssetLedgerAccountId = asset.ledgerAccountId;
});

test('pal client - created asset must have an new ledger in the liquidity system', async () => {
  // we have to wait for the ledger acount to be created in the read side of the ledger
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const [assetAccount] = await client.getLedgerAccounts([
    createdAssetLedgerAccountId
  ]);

  assert.ok(assetAccount);
  assert.ok(assetAccount.id, createdAssetLedgerAccountId);
  assert.equal(assetAccount.assetCode, ASSET_CODE);
  // asset id is the code (and that's the ext id for the ledger account
  assert.ok(assetAccount.externalId);
  assert.equal(assetAccount.externalId, ASSET_CODE);
  assert.equal(assetAccount.creditedAmount, '0');
  assert.equal(assetAccount.debitedAmount, '0');
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
 * Peer tests
 * */

test('pal client - create peer', async () => {
  await client.createPeer(
    PEER_ONE_ID,
    PEER_ONE_NAME,
    ASSET_CODE,
    ASSET_SCALE,
    PEER_ONE_ILP_STATIC_ADDRESS
  );
  assert.ok(true);
});

test('pal client - created peer must exist', async () => {
  const peer = await client.getPeer(PEER_ONE_ID);

  assert.ok(peer);
  assert.equal(peer.id, PEER_ONE_ID);
  assert.equal(peer.name, PEER_ONE_NAME);
  assert.equal(peer.assetCode, ASSET_CODE);
  assert.equal(peer.assetScale, ASSET_SCALE);
  assert.ok(peer.ledgerLiquidityAccountId);
  assert.ok(peer.ledgerClearingAccountId);

  assert.ok(peer.communicationMethodDefinition);
  assert.equal(peer.communicationMethodDefinition.type, 'ILP');
  assert.equal(
    peer.communicationMethodDefinition.staticAddress,
    PEER_ONE_ILP_STATIC_ADDRESS
  );

  createdPeerLiquidityAccountId = peer.ledgerLiquidityAccountId;
  createdPeerClearingAccountId = peer.ledgerClearingAccountId;
});

test('pal client - created peer must have an new set of ledger accounts', async () => {
  // we have to wait for the ledger acount to be created in the read side of the ledger
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const [liqAcc, cleAcc] = await client.getLedgerAccounts([
    createdPeerLiquidityAccountId,
    createdPeerClearingAccountId
  ]);

  assert.ok(liqAcc);
  assert.ok(liqAcc.id, createdPeerLiquidityAccountId);
  assert.equal(liqAcc.assetCode, ASSET_CODE);
  assert.ok(liqAcc.externalId);
  // asset id is the code (and that's the ext id for the ledger account
  assert.equal(liqAcc.externalId, PEER_ONE_ID);
  assert.equal(liqAcc.creditedAmount, '0');
  assert.equal(liqAcc.debitedAmount, '0');

  assert.ok(cleAcc);
  assert.ok(cleAcc.id, createdPeerClearingAccountId);
  assert.equal(cleAcc.assetCode, ASSET_CODE);
  assert.ok(cleAcc.externalId);
  // asset id is the code (and that's the ext id for the ledger account
  assert.equal(cleAcc.externalId, PEER_ONE_ID);
  assert.equal(cleAcc.creditedAmount, '0');
  assert.equal(cleAcc.debitedAmount, '0');
});

/*
 * Wallet address tests
 * */

test('pal client - create wallet address', async () => {
  const createdWallet = await client.createWalletAddress(
    ALIAS_DOMAIN,
    ALIAS_PATHNAME,
    PUBLIC_NAME,
    ASSET_CODE
  );

  assert.ok(createdWallet);
  assert.equal(createdWallet.domain, ALIAS_DOMAIN);
  assert.equal(createdWallet.pathName, ALIAS_PATHNAME);
  assert.equal(createdWallet.publicName, PUBLIC_NAME);
  assert.equal(createdWallet.assetCode, ASSET_CODE);
  assert.equal(createdWallet.assetScale, ASSET_SCALE);
  assert.equal(createdWallet.isActive, true);
});

// must run this here to resolve / get the internal wallet address id
test('pal client - resolve created wallet address', async () => {
  const alias = await client.ResolveWalletAddressAlias(
    ALIAS_DOMAIN,
    ALIAS_PATHNAME
  );

  createdWalletAddressId = alias.walletAddressId;

  assert.ok(alias);
  assert.ok(alias.walletAddressId);
  assert.equal(alias.domain, ALIAS_DOMAIN);
  assert.equal(alias.pathName, ALIAS_PATHNAME);
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
    await client.createWalletAddress(
      ALIAS_DOMAIN,
      ALIAS_PATHNAME,
      PUBLIC_NAME,
      ASSET_CODE
    );

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

test('pal client - create wallet address alias without domain', async () => {
  await client.createWalletAddressAlias(
    null,
    ALIAS_PATHNAME,
    createdWalletAddressId
  );
});
test('pal client - create wallet address alias with domain', async () => {
  // Must use another domain as the create wallet address test
  // above automatically creates the alias with domain
  await client.createWalletAddressAlias(
    'otherdomain.com',
    ALIAS_PATHNAME,
    createdWalletAddressId
  );
});

test('pal client - resolve wallet address alias without domain', async () => {
  const alias = await client.ResolveWalletAddressAlias(null, ALIAS_PATHNAME);

  assert.ok(alias);
  assert.ok(alias.walletAddressId);
  assert.equal(alias.domain, null);
  assert.equal(alias.pathName, ALIAS_PATHNAME);
});
test('pal client - resolve wallet address alias with domain', async () => {
  const address = await client.ResolveWalletAddressAlias(
    ALIAS_DOMAIN,
    ALIAS_PATHNAME
  );

  assert.ok(address);
  assert.equal(address.domain, ALIAS_DOMAIN);
  assert.equal(address.pathName, ALIAS_PATHNAME);
  assert.equal(address.walletAddressId, createdWalletAddressId);
});

test('pal client - resolve non existing wallet address alias with domain should fail', async () => {
  const address = await client.ResolveWalletAddressAlias(
    ALIAS_DOMAIN,
    'NON_EXISTING'
  );

  assert.equal(address === null, true);
});

test('pal client - resolve non existing wallet address alias without domain should fail', async () => {
  const address = await client.ResolveWalletAddressAlias(null, 'NON_EXISTING');

  assert.equal(address === null, true);
});

/*
 * parseAddressToDomainAndPathName tests
 * */

test('pal client - parseAddressToDomainAndPathName should work with full url', async () => {
  const { domain, pathName } = await parseAddressToDomainAndPathName(
    'http://domain.com/path/name'
  );

  assert.equal(domain, 'domain.com');
  assert.equal(pathName, 'path/name');
});

test('pal client - parseAddressToDomainAndPathName should work with url missing protocol', async () => {
  const { domain, pathName } = await parseAddressToDomainAndPathName(
    'domain.com/path/name'
  );

  assert.equal(domain, 'domain.com');
  assert.equal(pathName, 'path/name');
});

test('pal client - parseAddressToDomainAndPathName should work without a FQDN and return null domain', async () => {
  const { domain, pathName } =
    await parseAddressToDomainAndPathName('path/name');

  assert.equal(domain, null);
  assert.equal(pathName, 'path/name');
});

test('pal client - parseAddressToDomainAndPathName should work with short FQDN', async () => {
  const { domain, pathName } =
    await parseAddressToDomainAndPathName('a.io/path/name');

  assert.equal(domain, 'a.io');
  assert.equal(pathName, 'path/name');
});

test('pal client - parseAddressToDomainAndPathName should work with short FQDN with port and remove the port part', async () => {
  const { domain, pathName } = await parseAddressToDomainAndPathName(
    'a.io:8080/path/name'
  );

  assert.equal(domain, 'a.io');
  assert.equal(pathName, 'path/name');
});

test('pal client - parseAddressToDomainAndPathName should work with an odd FQDN like prefix and return null domain', async () => {
  const { domain, pathName } =
    await parseAddressToDomainAndPathName('.path/name');

  assert.equal(domain, null);
  assert.equal(pathName, '.path/name');
});

/*
 * pal client ledger low-level tests
 * */
