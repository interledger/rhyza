import { after, before, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import * as assert from 'node:assert/strict';
import {
  IGetIntraAseFxRate,
  IGetPeerFxRateFromSourceAsset,
  IGetPeerFxRateToDestinationAsset,
  PalClient,
  PalClientLedgerInsufficientFundsForWithdrawalError,
  PalClientDuplicateWalletAddressKeyError,
  PalClientPeerAlreadyActiveError,
  PalClientPeerAlreadyInactiveError,
  PalClientPeerNotFoundError,
  PalClientWalletAddressKeyAlreadyRevokedError,
  PalClientWalletAddressKeyNotFoundError,
  PalClientWalletAddressNotFoundError,
  parseAddressToDomainAndPathName
} from '../src';
import { IPalPeerDto } from 'pal-public-types-lib';

let client: PalClient;
const testPrefix = `TEST-${randomBytes(3).toString('hex')}`;

// const assetCode = `USD`;
const FIXED_ASSET_CODE = 'EUR';
const ASSET_CODE = `${testPrefix}_${FIXED_ASSET_CODE}`;
const STORED_ASSET_CODE = ASSET_CODE.toUpperCase();
const ASSET_SCALE = 2;
const DEPOSIT_AMOUNT = 5000n;
const MIN_AMOUNT = (1 * 10 ** ASSET_SCALE).toString();

const PEER_ONE_ID = `${testPrefix}_peer1`;
const PEER_ONE_NAME = `${testPrefix} Peer One`;
const PEER_ONE_ILP_STATIC_ADDRESS = `${testPrefix}_peer1.static.address`;
const PEER_ONE_ILP_ALTERNATE_STATIC_ADDRESS = `${testPrefix}_peer1.static.alt-address`;

const ALIAS_DOMAIN = `${testPrefix}_domain.com`;
const ALIAS_PATHNAME = `${testPrefix}_pedrobarreto`;
const PUBLIC_NAME = 'Pedro Barreto';

const FX_SOURCE_ASSET_CODE = `${testPrefix}_USD`;
const FX_DESTINATION_ASSET_CODE = `${testPrefix}_XRP`;
const STORED_FX_SOURCE_ASSET_CODE = FX_SOURCE_ASSET_CODE.toUpperCase();
const STORED_FX_DESTINATION_ASSET_CODE =
  FX_DESTINATION_ASSET_CODE.toUpperCase();
const FX_PEER_RATE = 1.2;
const FX_INTRAASE_RATE = 0.3;

let createdWalletAddressId: string;
let createdAssetLedgerAccountId: string;

let peerOneDto: IPalPeerDto;

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
  await client.createAsset(ASSET_CODE.toLowerCase(), ASSET_SCALE);

  // extra assets for fx tests
  await client.createAsset(FX_SOURCE_ASSET_CODE.toLowerCase(), ASSET_SCALE);
  await client.createAsset(
    FX_DESTINATION_ASSET_CODE.toLowerCase(),
    ASSET_SCALE
  );
  assert.ok(true);
});

test('pal client - created asset must exist', async () => {
  const [asset] = await client.getAssets([ASSET_CODE.toLowerCase()]);

  assert.ok(asset);
  assert.equal(asset.code, STORED_ASSET_CODE);
  assert.equal(asset.scale, ASSET_SCALE);

  const [sourceAsset] = await client.getAssets([
    FX_SOURCE_ASSET_CODE.toLowerCase()
  ]);
  assert.ok(sourceAsset);
  assert.equal(sourceAsset.code, STORED_FX_SOURCE_ASSET_CODE);

  const [destinationAsset] = await client.getAssets([
    FX_DESTINATION_ASSET_CODE.toLowerCase()
  ]);
  assert.ok(destinationAsset);
  assert.equal(destinationAsset.code, STORED_FX_DESTINATION_ASSET_CODE);

  assert.ok(asset.ledgerAccountId);
  createdAssetLedgerAccountId = asset.ledgerAccountId;
});

test('pal client - created asset must exist and have an new ledger in the liquidity system', async () => {
  // we have to wait for the ledger account to be created in the read side of the ledger
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const [assetAccount] = await client.getLedgerAccounts([
    createdAssetLedgerAccountId
  ]);

  assert.ok(assetAccount);
  assert.ok(assetAccount.id, createdAssetLedgerAccountId);
  assert.equal(assetAccount.assetCode, STORED_ASSET_CODE);
  // asset id is the code (and that's the ext id for the ledger account
  assert.equal(assetAccount.creditedAmount, '0');
  assert.equal(assetAccount.debitedAmount, '0');
  assert.equal(assetAccount.type, 'ASSET_LIQUIDITY_ACCOUNT');
});

test('pal client - created duplicate asset should fail', async () => {
  try {
    await client.createAsset(ASSET_CODE, ASSET_SCALE);

    assert.fail();
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.ok(e.message.includes('already exists'));
  }
});

test('pal client - get non existing asset should fail', async () => {
  const assets = await client.getAssets(['NON EXISTING']);

  assert.equal(assets.length, 0);
});

/*
 * Peer tests
 * */

test('pal client - create peer', async () => {
  await client.createPeer(
    PEER_ONE_ID,
    PEER_ONE_NAME,
    STORED_ASSET_CODE,
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
  assert.equal(peer.assetCode, STORED_ASSET_CODE);
  assert.equal(peer.assetScale, ASSET_SCALE);
  assert.ok(peer.ledgerAccounts);
  assert.ok(peer.ledgerAccounts.peerLiquidityAccId);
  assert.ok(peer.ledgerAccounts.peerClearingAccId);
  assert.ok(peer.ledgerAccounts.aseLiquidityAccId);
  assert.ok(peer.ledgerAccounts.aseClearingAccId);
  assert.ok(peer.ledgerAccounts.suspenseAccId);

  assert.ok(peer.communicationMethodDefinition);
  assert.equal(peer.communicationMethodDefinition.type, 'ILP');
  assert.equal(
    peer.communicationMethodDefinition.staticAddress,
    PEER_ONE_ILP_STATIC_ADDRESS
  );
  peerOneDto = peer;
});

test('pal client - get created peer by ILP Address', async () => {
  const peer = await client.getPeerByIlpAddress(PEER_ONE_ILP_STATIC_ADDRESS);

  assert.ok(peer);
  assert.equal(peer.id, PEER_ONE_ID);
  assert.equal(peer.name, PEER_ONE_NAME);
  assert.equal(peer.assetCode, STORED_ASSET_CODE);
  assert.equal(peer.assetScale, ASSET_SCALE);
  assert.ok(peer.ledgerAccounts);
  assert.ok(peer.ledgerAccounts.peerLiquidityAccId);
  assert.ok(peer.ledgerAccounts.peerClearingAccId);
  assert.ok(peer.ledgerAccounts.aseLiquidityAccId);
  assert.ok(peer.ledgerAccounts.aseClearingAccId);
  assert.ok(peer.ledgerAccounts.suspenseAccId);

  assert.ok(peer.communicationMethodDefinition);
  assert.equal(peer.communicationMethodDefinition.type, 'ILP');
  assert.equal(
    peer.communicationMethodDefinition.staticAddress,
    PEER_ONE_ILP_STATIC_ADDRESS
  );
  peerOneDto = peer;
});

test('pal client - update peer ILP Address', async () => {
  await client.setPeerCommunicationMethod(
    PEER_ONE_ID,
    PEER_ONE_ILP_ALTERNATE_STATIC_ADDRESS
  );

  let peer = await client.getPeerByIlpAddress(
    PEER_ONE_ILP_ALTERNATE_STATIC_ADDRESS
  );

  assert.ok(peer);
  assert.equal(peer.id, PEER_ONE_ID);

  assert.ok(peer.communicationMethodDefinition);
  assert.equal(peer.communicationMethodDefinition.type, 'ILP');
  assert.equal(
    peer.communicationMethodDefinition.staticAddress,
    PEER_ONE_ILP_ALTERNATE_STATIC_ADDRESS
  );

  // revert for remaining tests

  await client.setPeerCommunicationMethod(
    PEER_ONE_ID,
    PEER_ONE_ILP_STATIC_ADDRESS
  );

  peer = await client.getPeerByIlpAddress(PEER_ONE_ILP_STATIC_ADDRESS);
  assert.ok(peer);
  assert.equal(peer.id, PEER_ONE_ID);

  assert.ok(peer.communicationMethodDefinition);
  assert.equal(peer.communicationMethodDefinition.type, 'ILP');
  assert.equal(
    peer.communicationMethodDefinition.staticAddress,
    PEER_ONE_ILP_STATIC_ADDRESS
  );
});

test('pal client - deactivate peer', async () => {
  await client.deactivatePeer(PEER_ONE_ID);

  const peer = await client.getPeer(PEER_ONE_ID);

  assert.ok(peer);
  assert.equal(peer.id, PEER_ONE_ID);
  assert.equal(peer.active, false);
});

test('pal client - deactivating an inactive peer fails', async () => {
  await assert.rejects(
    client.deactivatePeer(PEER_ONE_ID),
    PalClientPeerAlreadyInactiveError
  );
});

test('pal client - deactivating an unknown peer fails', async () => {
  await assert.rejects(
    client.deactivatePeer(`${testPrefix}_no_such_peer`),
    PalClientPeerNotFoundError
  );
});

test('pal client - re-activating peer', async () => {
  await client.activatePeer(PEER_ONE_ID);

  const peer = await client.getPeer(PEER_ONE_ID);

  assert.ok(peer);
  assert.equal(peer.id, PEER_ONE_ID);
  assert.equal(peer.active, true);
});

test('pal client - activating an active peer fails', async () => {
  await assert.rejects(
    client.activatePeer(PEER_ONE_ID),
    PalClientPeerAlreadyActiveError
  );
});

test('pal client - activating an unknown peer fails', async () => {
  await assert.rejects(
    client.activatePeer(`${testPrefix}_no_such_peer`),
    PalClientPeerNotFoundError
  );
});

test('pal client - created peer must have an new set of ledger accounts', async () => {
  // we have to wait for the ledger acount to be created in the read side of the ledger
  await new Promise((resolve) => setTimeout(resolve, 10000));
  const accountIds: string[] = Object.values(peerOneDto.ledgerAccounts);
  const deadline = Date.now() + 20_000;
  let accounts = await client.getLedgerAccounts(accountIds);
  while (accounts.length < accountIds.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    accounts = await client.getLedgerAccounts(accountIds);
  }

  assert.ok(accounts);
  assert.equal(accounts.length, 5);

  const peerLiqAcc = accounts.find(
    (a) => a.id === peerOneDto.ledgerAccounts.peerLiquidityAccId
  );
  assert.ok(peerLiqAcc);
  assert.equal(peerLiqAcc.id, peerOneDto.ledgerAccounts.peerLiquidityAccId);
  assert.equal(peerLiqAcc.assetCode, STORED_ASSET_CODE);
  assert.equal(peerLiqAcc.peerId, PEER_ONE_ID);
  assert.equal(peerLiqAcc.creditedAmount, '0');
  assert.equal(peerLiqAcc.debitedAmount, '0');

  const peerCleAcc = accounts.find(
    (a) => a.id === peerOneDto.ledgerAccounts.peerClearingAccId
  );
  assert.ok(peerCleAcc);
  assert.equal(peerCleAcc.id, peerOneDto.ledgerAccounts.peerClearingAccId);
  assert.equal(peerCleAcc.assetCode, STORED_ASSET_CODE);
  assert.equal(peerCleAcc.peerId, PEER_ONE_ID);
  assert.equal(peerCleAcc.creditedAmount, '0');
  assert.equal(peerCleAcc.debitedAmount, '0');

  const aseLiqAcc = accounts.find(
    (a) => a.id === peerOneDto.ledgerAccounts.aseLiquidityAccId
  );
  assert.ok(aseLiqAcc);
  assert.equal(aseLiqAcc.id, peerOneDto.ledgerAccounts.aseLiquidityAccId);
  assert.equal(aseLiqAcc.assetCode, STORED_ASSET_CODE);
  assert.equal(aseLiqAcc.peerId, PEER_ONE_ID);
  assert.equal(aseLiqAcc.creditedAmount, '0');
  assert.equal(aseLiqAcc.debitedAmount, '0');

  const aseCleAcc = accounts.find(
    (a) => a.id === peerOneDto.ledgerAccounts.aseClearingAccId
  );
  assert.ok(aseCleAcc);
  assert.equal(aseCleAcc.id, peerOneDto.ledgerAccounts.aseClearingAccId);
  assert.equal(aseCleAcc.assetCode, STORED_ASSET_CODE);
  assert.equal(aseCleAcc.peerId, PEER_ONE_ID);
  assert.equal(aseCleAcc.creditedAmount, '0');
  assert.equal(aseCleAcc.debitedAmount, '0');

  const suspenseAcc = accounts.find(
    (a) => a.id === peerOneDto.ledgerAccounts.suspenseAccId
  );
  assert.ok(suspenseAcc);
  assert.equal(suspenseAcc.id, peerOneDto.ledgerAccounts.suspenseAccId);
  assert.equal(suspenseAcc.assetCode, STORED_ASSET_CODE);
  assert.equal(suspenseAcc.peerId, PEER_ONE_ID);
  assert.equal(suspenseAcc.creditedAmount, '0');
  assert.equal(suspenseAcc.debitedAmount, '0');
});

/*
 * Liquidity Management Tests
 * */

test('pal client - LiquidityManagement - Deposit to ASE', async () => {
  const reqId = 'req1';
  const resp = await client.ledgerDepositToAse({
    peerId: PEER_ONE_ID,
    assetCode: STORED_ASSET_CODE,
    amount: DEPOSIT_AMOUNT.toString(),
    amountScale: ASSET_SCALE,
    requestId: reqId
  });

  assert.ok(resp);
  assert.equal(resp.requestId, reqId);
  assert.equal(resp.peerId, PEER_ONE_ID);
  assert.equal(resp.isError, false);
  assert.equal(resp.externalId, undefined);
  assert.equal(resp.errorMessage, undefined);
});

test('pal client - LiquidityManagement - Withdraw from ASE', async () => {
  const reqId = 'req3';
  const resp = await client.ledgerWithdrawFromAse({
    peerId: PEER_ONE_ID,
    assetCode: STORED_ASSET_CODE,
    amount: DEPOSIT_AMOUNT.toString(),
    amountScale: ASSET_SCALE,
    requestId: reqId
  });

  assert.ok(resp);
  assert.equal(resp.requestId, reqId);
  assert.equal(resp.peerId, PEER_ONE_ID);
  assert.equal(resp.isError, false);
  assert.equal(resp.externalId, undefined);
  assert.equal(resp.errorMessage, undefined);
});

test('pal client - LiquidityManagement - Withdraw excess liquidity from ASE should fail', async () => {
  try {
    const reqId = 'req4';
    await client.ledgerWithdrawFromAse({
      peerId: PEER_ONE_ID,
      assetCode: STORED_ASSET_CODE,
      amount: MIN_AMOUNT,
      amountScale: ASSET_SCALE,
      requestId: reqId
    });
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof PalClientLedgerInsufficientFundsForWithdrawalError);
  }
});

test('pal client - LiquidityManagement - Deposit to Peer', async () => {
  const reqId = 'req2';
  const resp = await client.ledgerDepositToPeer({
    peerId: PEER_ONE_ID,
    assetCode: STORED_ASSET_CODE,
    amount: DEPOSIT_AMOUNT.toString(),
    amountScale: ASSET_SCALE,
    requestId: reqId
  });

  assert.ok(resp);
  assert.equal(resp.requestId, reqId);
  assert.equal(resp.peerId, PEER_ONE_ID);
  assert.equal(resp.isError, false);
  assert.equal(resp.externalId, undefined);
  assert.equal(resp.errorMessage, undefined);
});

test('pal client - LiquidityManagement - Withdraw from Peer', async () => {
  const reqId = 'req4';
  const resp = await client.ledgerWithdrawFromPeer({
    peerId: PEER_ONE_ID,
    assetCode: STORED_ASSET_CODE,
    amount: DEPOSIT_AMOUNT.toString(),
    amountScale: ASSET_SCALE,
    requestId: reqId
  });

  assert.ok(resp);
  assert.equal(resp.requestId, reqId);
  assert.equal(resp.peerId, PEER_ONE_ID);
  assert.equal(resp.isError, false);
  assert.equal(resp.externalId, undefined);
  assert.equal(resp.errorMessage, undefined);
});

test('pal client - LiquidityManagement - Withdraw excess liquidity from Peer should fail', async () => {
  try {
    const reqId = 'req4';
    await client.ledgerWithdrawFromPeer({
      peerId: PEER_ONE_ID,
      assetCode: STORED_ASSET_CODE,
      amount: MIN_AMOUNT,
      amountScale: ASSET_SCALE,
      requestId: reqId
    });
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof PalClientLedgerInsufficientFundsForWithdrawalError);
  }
});

/*
 * Liquidity Management Tests
 * */

test('pal client - LiquidityManagement - Deposit to ASE', async () => {
  const reqId = 'req1';
  const resp = await client.ledgerDepositToAse({
    peerId: PEER_ONE_ID,
    assetCode: STORED_ASSET_CODE,
    amount: DEPOSIT_AMOUNT.toString(),
    amountScale: ASSET_SCALE,
    requestId: reqId
  });

  assert.ok(resp);
  assert.equal(resp.requestId, reqId);
  assert.equal(resp.peerId, PEER_ONE_ID);
  assert.equal(resp.isError, false);
  assert.equal(resp.externalId, undefined);
  assert.equal(resp.errorMessage, undefined);
});

test('pal client - LiquidityManagement - Withdraw from ASE', async () => {
  const reqId = 'req3';
  const resp = await client.ledgerWithdrawFromAse({
    peerId: PEER_ONE_ID,
    assetCode: STORED_ASSET_CODE,
    amount: DEPOSIT_AMOUNT.toString(),
    amountScale: ASSET_SCALE,
    requestId: reqId
  });

  assert.ok(resp);
  assert.equal(resp.requestId, reqId);
  assert.equal(resp.peerId, PEER_ONE_ID);
  assert.equal(resp.isError, false);
  assert.equal(resp.externalId, undefined);
  assert.equal(resp.errorMessage, undefined);
});

test('pal client - LiquidityManagement - Withdraw excess liquidity from ASE should fail', async () => {
  try {
    const reqId = 'req4';
    await client.ledgerWithdrawFromAse({
      peerId: PEER_ONE_ID,
      assetCode: STORED_ASSET_CODE,
      amount: MIN_AMOUNT,
      amountScale: ASSET_SCALE,
      requestId: reqId
    });
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof PalClientLedgerInsufficientFundsForWithdrawalError);
  }
});

test('pal client - LiquidityManagement - Deposit to Peer', async () => {
  const reqId = 'req2';
  const resp = await client.ledgerDepositToPeer({
    peerId: PEER_ONE_ID,
    assetCode: STORED_ASSET_CODE,
    amount: DEPOSIT_AMOUNT.toString(),
    amountScale: ASSET_SCALE,
    requestId: reqId
  });

  assert.ok(resp);
  assert.equal(resp.requestId, reqId);
  assert.equal(resp.peerId, PEER_ONE_ID);
  assert.equal(resp.isError, false);
  assert.equal(resp.externalId, undefined);
  assert.equal(resp.errorMessage, undefined);
});

test('pal client - LiquidityManagement - Withdraw from Peer', async () => {
  const reqId = 'req4';
  const resp = await client.ledgerWithdrawFromPeer({
    peerId: PEER_ONE_ID,
    assetCode: STORED_ASSET_CODE,
    amount: DEPOSIT_AMOUNT.toString(),
    amountScale: ASSET_SCALE,
    requestId: reqId
  });

  assert.ok(resp);
  assert.equal(resp.requestId, reqId);
  assert.equal(resp.peerId, PEER_ONE_ID);
  assert.equal(resp.isError, false);
  assert.equal(resp.externalId, undefined);
  assert.equal(resp.errorMessage, undefined);
});

test('pal client - LiquidityManagement - Withdraw excess liquidity from Peer should fail', async () => {
  try {
    const reqId = 'req4';
    await client.ledgerWithdrawFromPeer({
      peerId: PEER_ONE_ID,
      assetCode: STORED_ASSET_CODE,
      amount: MIN_AMOUNT,
      amountScale: ASSET_SCALE,
      requestId: reqId
    });
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof PalClientLedgerInsufficientFundsForWithdrawalError);
  }
});

/*
 * FX Tests
 * */
test('pal client - set fx intra ASE rates from ase', async () => {
  await client.setFxRate(
    STORED_FX_SOURCE_ASSET_CODE,
    STORED_FX_DESTINATION_ASSET_CODE,
    FX_INTRAASE_RATE,
    null,
    null
  );
});

test('pal client - get fx intra ASE rates from ase', async () => {
  const request: IGetIntraAseFxRate = {
    sourceAssetCode: STORED_FX_SOURCE_ASSET_CODE,
    destinationAssetCode: STORED_FX_DESTINATION_ASSET_CODE
  };

  const resp = await client.getFxRate(request);

  assert.ok(resp);
  assert.equal(resp, FX_INTRAASE_RATE);
});

test('pal client - set fx peer rates from ase', async () => {
  await client.setFxRate(
    STORED_ASSET_CODE,
    STORED_FX_DESTINATION_ASSET_CODE,
    FX_PEER_RATE,
    PEER_ONE_ID,
    null
  );

  await client.setFxRate(
    STORED_FX_SOURCE_ASSET_CODE,
    STORED_ASSET_CODE,
    FX_PEER_RATE,
    PEER_ONE_ID,
    null
  );
});

test('pal client - get fx peer - peer asset to destination asset', async () => {
  const request: IGetPeerFxRateToDestinationAsset = {
    peerId: PEER_ONE_ID,
    destinationAssetCode: STORED_FX_DESTINATION_ASSET_CODE
  };

  const resp = await client.getFxRate(request);

  assert.ok(resp);
  assert.equal(resp, FX_PEER_RATE);
});

test('pal client - get fx peer - source asset to peer asset', async () => {
  const request: IGetPeerFxRateFromSourceAsset = {
    peerId: PEER_ONE_ID,
    sourceAssetCode: STORED_FX_SOURCE_ASSET_CODE
  };

  const resp = await client.getFxRate(request);

  assert.ok(resp);
  assert.equal(resp, FX_PEER_RATE);
});

test('pal client - set fx peer with inexistent source asset should fail', async () => {
  try {
    await client.setFxRate(
      'NON_EXISTING_ASSET_CODE',
      STORED_ASSET_CODE,
      FX_PEER_RATE,
      PEER_ONE_ID,
      null
    );
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof Error);
  }
});

test('pal client - set fx peer with inexistent destiantion asset should fail', async () => {
  try {
    await client.setFxRate(
      STORED_ASSET_CODE,
      'NON_EXISTING_ASSET_CODE',
      FX_PEER_RATE,
      PEER_ONE_ID,
      null
    );
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof Error);
  }
});

test('pal client - set fx peer with inexistent peer should fail', async () => {
  try {
    await client.setFxRate(
      STORED_FX_SOURCE_ASSET_CODE,
      STORED_FX_DESTINATION_ASSET_CODE,
      FX_PEER_RATE,
      'NON_EXISTING_PEER',
      null
    );
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof Error);
  }
});

/*
 * Wallet address tests
 * */

test('pal client - create wallet address', async () => {
  const createdWallet = await client.createWalletAddress(
    ALIAS_DOMAIN,
    ALIAS_PATHNAME,
    PUBLIC_NAME,
    STORED_ASSET_CODE
  );

  assert.ok(createdWallet);
  assert.ok(createdWallet.id);
  assert.equal(createdWallet.domain, ALIAS_DOMAIN);
  assert.equal(createdWallet.pathName, ALIAS_PATHNAME);
  assert.equal(createdWallet.publicName, PUBLIC_NAME);
  assert.equal(createdWallet.assetCode, STORED_ASSET_CODE);
  assert.equal(createdWallet.assetScale, ASSET_SCALE);
  assert.equal(createdWallet.isActive, true);

  createdWalletAddressId = createdWallet.id;
});

// must run this here to resolve / get the internal wallet address id
test('pal client - resolve created wallet address', async () => {
  const walletAddress = await client.resolveWalletAddressByAlias(
    ALIAS_DOMAIN,
    ALIAS_PATHNAME
  );

  assert.ok(walletAddress);
  assert.ok(walletAddress.id);
  assert.equal(walletAddress.publicName, PUBLIC_NAME);
  assert.equal(walletAddress.assetCode, STORED_ASSET_CODE);
  assert.equal(walletAddress.assetScale, ASSET_SCALE);
  assert.equal(walletAddress.isActive, true);

  createdWalletAddressId = walletAddress.id;
});

test('pal client - get wallet', async () => {
  const walletAddress = await client.getWalletAddresses([
    createdWalletAddressId
  ]);

  assert.ok(walletAddress);
  assert.equal(walletAddress.length, 1);
  assert.equal(walletAddress[0].id, createdWalletAddressId);
  assert.equal(walletAddress[0].publicName, PUBLIC_NAME);
  assert.equal(walletAddress[0].assetCode, STORED_ASSET_CODE);
  assert.equal(walletAddress[0].assetScale, ASSET_SCALE);
  assert.equal(walletAddress[0].isActive, true);
});

test('pal client - created duplicate wallet should fail', async () => {
  try {
    await client.createWalletAddress(
      ALIAS_DOMAIN,
      ALIAS_PATHNAME,
      PUBLIC_NAME,
      STORED_ASSET_CODE
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

test('pal client - resolve wallet address by alias without domain', async () => {
  const walletAddress = await client.resolveWalletAddressByAlias(
    null,
    ALIAS_PATHNAME
  );

  assert.ok(walletAddress);
  assert.equal(walletAddress.id, createdWalletAddressId);
  assert.equal(walletAddress.publicName, PUBLIC_NAME);
});

test('pal client - resolve wallet address by alias with domain', async () => {
  const walletAddress = await client.resolveWalletAddressByAlias(
    ALIAS_DOMAIN,
    ALIAS_PATHNAME
  );

  assert.ok(walletAddress);
  assert.equal(walletAddress.id, createdWalletAddressId);
  assert.equal(walletAddress.publicName, PUBLIC_NAME);
  assert.equal(walletAddress.assetCode, STORED_ASSET_CODE);
});

test('pal client - resolve non existing wallet address alias with domain should fail', async () => {
  const address = await client.resolveWalletAddressByAlias(
    ALIAS_DOMAIN,
    'NON_EXISTING'
  );

  assert.equal(address === null, true);
});

test('pal client - resolve non existing wallet address alias without domain should fail', async () => {
  const address = await client.resolveWalletAddressByAlias(
    null,
    'NON_EXISTING'
  );

  assert.equal(address === null, true);
});

test('pal client - add wallet address key', async () => {
  const keyId = await client.addWalletAddressKey(createdWalletAddressId, {
    kid: `${testPrefix}_key-1`,
    alg: 'EdDSA',
    kty: 'OKP',
    crv: 'Ed25519',
    x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo'
  });

  assert.ok(keyId);
  const keys = await client.getWalletAddressKeys(createdWalletAddressId);
  assert.equal(keys.length, 1);
  assert.equal(keys[0].id, keyId);
  assert.equal(keys[0].walletAddressId, createdWalletAddressId);
  assert.equal(keys[0].jwk.kid, `${testPrefix}_key-1`);
  assert.equal(keys[0].revoked, false);
});

test('pal client - add duplicate wallet address key kid should fail', async () => {
  try {
    await client.addWalletAddressKey(createdWalletAddressId, {
      kid: `${testPrefix}_key-1`,
      alg: 'EdDSA',
      kty: 'OKP',
      crv: 'Ed25519',
      x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo'
    });
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof PalClientDuplicateWalletAddressKeyError);
  }
});

test('pal client - revoke wallet address key', async () => {
  const keys = await client.getWalletAddressKeys(createdWalletAddressId);
  const key = keys.find((item) => item.jwk.kid === `${testPrefix}_key-1`);
  assert.ok(key);
  assert.equal(key.revoked, false);

  await client.revokeWalletAddressKey(createdWalletAddressId, key.id);

  const revoked = (
    await client.getWalletAddressKeys(createdWalletAddressId)
  ).find((item) => item.id === key.id);
  assert.equal(revoked?.revoked, true);
  assert.ok(revoked?.revokedAt instanceof Date);

  try {
    await client.revokeWalletAddressKey(createdWalletAddressId, key.id);
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof PalClientWalletAddressKeyAlreadyRevokedError);
  }

  const again = (
    await client.getWalletAddressKeys(createdWalletAddressId)
  ).find((item) => item.id === key.id);
  assert.equal(again?.revokedAt?.getTime(), revoked?.revokedAt?.getTime());
});

test('pal client - revoke missing wallet address key should fail', async () => {
  try {
    await client.revokeWalletAddressKey(createdWalletAddressId, 'missing-key');
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof PalClientWalletAddressKeyNotFoundError);
  }
});

test('pal client - add wallet address key for missing wallet should fail', async () => {
  try {
    await client.addWalletAddressKey('missing-wallet', {
      kid: `${testPrefix}_missing`,
      alg: 'EdDSA',
      kty: 'OKP',
      crv: 'Ed25519',
      x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo'
    });
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof PalClientWalletAddressNotFoundError);
  }
});

/*
 * parseAddressToDomainAndPathName tests
 * */

test('pal client - parseAddressToDomainAndPathName should work with full url', async () => {
  const { domain, pathName } = parseAddressToDomainAndPathName(
    'http://domain.com/path/name'
  );

  assert.equal(domain, 'domain.com');
  assert.equal(pathName, 'path/name');
});

test('pal client - parseAddressToDomainAndPathName should work with url missing protocol', async () => {
  const { domain, pathName } = parseAddressToDomainAndPathName(
    'domain.com/path/name'
  );

  assert.equal(domain, 'domain.com');
  assert.equal(pathName, 'path/name');
});

test('pal client - parseAddressToDomainAndPathName should work without a FQDN and return null domain', async () => {
  const { domain, pathName } = parseAddressToDomainAndPathName('path/name');

  assert.equal(domain, null);
  assert.equal(pathName, 'path/name');
});

test('pal client - parseAddressToDomainAndPathName should work with short FQDN', async () => {
  const { domain, pathName } =
    parseAddressToDomainAndPathName('a.io/path/name');

  assert.equal(domain, 'a.io');
  assert.equal(pathName, 'path/name');
});

test('pal client - parseAddressToDomainAndPathName should work with short FQDN with port and remove the port part', async () => {
  const { domain, pathName } = parseAddressToDomainAndPathName(
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

test('pal client - parseAddressToDomainAndPathName should work with only a name and return null domain', async () => {
  const { domain, pathName } = parseAddressToDomainAndPathName('name');

  assert.equal(domain, null);
  assert.equal(pathName, 'name');
});
