import { before, test, mock, after } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  AssetAggregate,
  CannotCreateDuplicatePeerError,
  CannotCreateDuplicateWalletAddressAliasError,
  CannotCreateDuplicateWalletAddressError,
  FxAggregate,
  IPalAssetRepository,
  IPalFxRepository,
  IPalPeerRepository,
  IPalWalletAddressRepository,
  PeerAggregate,
  PeerAlreadyActiveError,
  PeerAlreadyInactiveError,
  FxCacheExpiryService,
  WalletAddressAggregate,
  WalletAddressAlreadyActiveError,
  WalletAddressAlreadyInactiveError,
  WalletAddressNotFoundError
} from '../src';
import {
  MockAssetRepo,
  MockFxRepo,
  MockMessageProducer,
  MockPeerRepo,
  MockWalletRepo
} from './mocks';
import { DomainEvent, IMessage, NullLogger } from 'common-types-lib';
import {
  PeerActivatedEvent,
  PeerCreatedEvent,
  PeerCreationCompletedEvent,
  PeerDeactivatedEvent,
  WalletAddressAliasCreatedEvent,
  WalletAddressCreatedEvent
} from 'pal-public-types-lib';
import { MockAseFxService } from './mocks/mock-ase-fx-service';

const logger = new NullLogger();

const mockMessageStore: IMessage[] = [];
const msgPublisher = new MockMessageProducer(mockMessageStore);

let assetAggregate: AssetAggregate;
let assetRepository: IPalAssetRepository;

let walletAggregate: WalletAddressAggregate;
let walletRepository: IPalWalletAddressRepository;

let peerAggregate: PeerAggregate;
let peerRepository: IPalPeerRepository;

let fxAggregate: FxAggregate;
let fxRepository: IPalFxRepository;

const ASSET_CODE = 'EUR';
const ASSET_SCALE = 2;

const ALIAS_DOMAIN = 'domain.com';
const ALIAS_PATHNAME = 'pedrobarreto';
const PUBLIC_NAME = 'Pedro Barreto';

const PEER_ONE_ID = 'peer1';
const PEER_ONE_NAME = 'Peer One';
const PEER_ONE_ILP_ADDRESS = 'ilp://peerone.com/';

const FX_SOURCE_ASSET_CODE = 'USD';
const FX_DESTINATION_ASSET_CODE = 'XRP';
const FX_PEER_RATE = 1.2;

let createdWalletAddressInternalId: string;
const mockAseFxSvc = new MockAseFxService();

const fxCacheExpiryService = new FxCacheExpiryService(msgPublisher, logger);

before(async () => {
  assetRepository = new MockAssetRepo();
  assetAggregate = new AssetAggregate(assetRepository, logger);

  walletRepository = new MockWalletRepo();
  walletAggregate = new WalletAddressAggregate(walletRepository, logger);

  peerRepository = new MockPeerRepo();
  peerAggregate = new PeerAggregate(peerRepository, logger);

  fxRepository = new MockFxRepo();

  fxAggregate = new FxAggregate(
    fxRepository,
    mockAseFxSvc,
    fxCacheExpiryService,
    logger
  );
});

after(() => {
  fxCacheExpiryService.destroy();
});

//region assets
test('PAL Asset Domain - create asset', async () => {
  await assetAggregate.createAsset(ASSET_CODE, ASSET_SCALE);
});

test('PAL Asset Domain - get asset', async () => {
  const assets = await assetAggregate.getAssets([ASSET_CODE]);

  assert.ok(assets.length);
  const asset = assets[0];
  assert.equal(asset.code, ASSET_CODE);
  assert.equal(asset.scale, ASSET_SCALE);
});

test('PAL Asset Domain - created duplicate asset should fail', async () => {
  try {
    await assetAggregate.createAsset(ASSET_CODE, ASSET_SCALE);

    assert.fail();
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.ok(e.message.includes('already exists'));
  }
});

test('PAL Asset Domain - get assets without codes returns all assets', async () => {
  const assets = await assetAggregate.getAssets();

  assert.ok(assets.some((asset) => asset.code === ASSET_CODE));
});

test('PAL Asset Domain - get non existing asset should fail', async () => {
  const assets = await assetAggregate.getAssets(['NON EXISTING']);

  assert.ok(assets.length === 0);
});
//endregion assets

//region peers
test('PAL Peer Domain - create peer', async () => {
  await peerAggregate.createPeer(
    PEER_ONE_ID,
    PEER_ONE_NAME,
    ASSET_CODE,
    ASSET_SCALE,
    {
      type: 'ILP',
      staticAddress: PEER_ONE_ILP_ADDRESS
    }
  );

  const lastDomainEvent = peerAggregate.uncommittedDomainEvents.at(
    -1
  ) as DomainEvent;
  assert.ok(lastDomainEvent);
  assert.equal(lastDomainEvent.msgName, PeerCreatedEvent.name);
  assert.equal(lastDomainEvent.aggregateId, PEER_ONE_ID);
  assert.ok(lastDomainEvent.payload);
  assert.equal(lastDomainEvent.payload.peerId, PEER_ONE_ID);
  assert.equal(lastDomainEvent.payload.assetCode, ASSET_CODE);
});

test('PAL Peer Domain - get Peer', async () => {
  const peer = await peerAggregate.getPeer(PEER_ONE_ID);

  assert.ok(peer);
  assert.equal(peer.id, PEER_ONE_ID);
  assert.equal(peer.name, PEER_ONE_NAME);
  assert.equal(peer.assetCode, ASSET_CODE);
  assert.equal(peer.assetScale, ASSET_SCALE);
  assert.ok(peer.communicationMethod);
  assert.equal(peer.communicationMethod.type, 'ILP');
  assert.equal(peer.communicationMethod.staticAddress, PEER_ONE_ILP_ADDRESS);
});

test('PAL Peer Domain - created duplicate peer should fail', async () => {
  try {
    await peerAggregate.createPeer(
      PEER_ONE_ID,
      PEER_ONE_NAME,
      ASSET_CODE,
      ASSET_SCALE,
      {
        type: 'ILP',
        staticAddress: PEER_ONE_ILP_ADDRESS
      }
    );

    assert.fail();
  } catch (e) {
    assert.ok(e instanceof CannotCreateDuplicatePeerError);
    assert.ok(e.message.includes('already exists'));
  }
});

test('PAL Peer Domain - associate ledger accounts and activate', async () => {
  await peerAggregate.associateLedgerAccountsAndActivate(
    PEER_ONE_ID,
    'peerLiqAcc',
    'peerClearAcc',
    'aseLiqAcc',
    'aseClearAcc',
    'suspenseAcc'
  );

  const lastDomainEvent = peerAggregate.uncommittedDomainEvents.at(
    -1
  ) as DomainEvent;
  assert.ok(lastDomainEvent);
  assert.equal(lastDomainEvent.msgName, PeerCreationCompletedEvent.name);
  assert.equal(lastDomainEvent.aggregateId, PEER_ONE_ID);
  assert.ok(lastDomainEvent.payload);
  assert.equal(lastDomainEvent.payload.peerId, PEER_ONE_ID);
});

test('PAL Peer Domain - activate already active peer fail', async () => {
  try {
    await peerAggregate.activate(PEER_ONE_ID);

    assert.fail();
  } catch (e) {
    assert.ok(e instanceof PeerAlreadyActiveError);
  }
});

test('PAL Peer Domain - deactivate peer', async () => {
  await peerAggregate.deactivate(PEER_ONE_ID);

  const peer = await peerAggregate.getPeer(PEER_ONE_ID);
  assert.ok(peer);
  assert.equal(peer.active, false);

  const lastDomainEvent = peerAggregate.uncommittedDomainEvents.at(
    -1
  ) as DomainEvent;
  assert.ok(lastDomainEvent);
  assert.equal(lastDomainEvent.msgName, PeerDeactivatedEvent.name);
  assert.equal(lastDomainEvent.aggregateId, PEER_ONE_ID);
  assert.ok(lastDomainEvent.payload);
  assert.equal(lastDomainEvent.payload.peerId, PEER_ONE_ID);
});

test('PAL Peer Domain - deactivate already inactive peer fail', async () => {
  try {
    await peerAggregate.deactivate(PEER_ONE_ID);

    assert.fail();
  } catch (e) {
    assert.ok(e instanceof PeerAlreadyInactiveError);
  }
});

test('PAL Peer Domain - re-activate peer', async () => {
  await peerAggregate.activate(PEER_ONE_ID);

  const peer = await peerAggregate.getPeer(PEER_ONE_ID);
  assert.ok(peer);
  assert.equal(peer.active, true);

  const lastDomainEvent = peerAggregate.uncommittedDomainEvents.at(
    -1
  ) as DomainEvent;
  assert.ok(lastDomainEvent);
  assert.equal(lastDomainEvent.msgName, PeerActivatedEvent.name);
  assert.equal(lastDomainEvent.aggregateId, PEER_ONE_ID);
  assert.ok(lastDomainEvent.payload);
  assert.equal(lastDomainEvent.payload.peerId, PEER_ONE_ID);
});

test('PAL Peer Domain - update comms method address', async () => {
  const newAddress = 'ilp://peerone.org/';
  await peerAggregate.setCommunicationMethodDefinition(PEER_ONE_ID, {
    type: 'ILP',
    staticAddress: newAddress
  });

  const peer = await peerAggregate.getPeer(PEER_ONE_ID);
  assert.ok(peer);
  assert.equal(peer.communicationMethod.type, 'ILP');
  assert.equal(peer.communicationMethod.staticAddress, newAddress);
});

//endregion peers

//region fx

// get system rate

test('PAL Forex Domain - get peer rate without exising rate should fetch it from ase', async () => {
  // use mock to ensure that the fx is fetched from ASE
  mock.reset();
  mock.method(mockAseFxSvc, 'getPeerFxFromAse');

  const fx = await fxAggregate.getPeerFxRate(
    PEER_ONE_ID,
    FX_SOURCE_ASSET_CODE,
    FX_DESTINATION_ASSET_CODE
  );

  assert.equal(fx, mockAseFxSvc.defaultRate);
  assert.equal(mockAseFxSvc.getPeerFxFromAse.mock.calls.length, 1);
});

test('PAL Forex Domain - get peer rate a second time should use locally cached fx', async () => {
  // use mock to ensure that the fx is NOT fetched from ASE
  mock.reset();
  mock.method(mockAseFxSvc, 'getPeerFxFromAse');

  const fx = await fxAggregate.getPeerFxRate(
    PEER_ONE_ID,
    FX_SOURCE_ASSET_CODE,
    FX_DESTINATION_ASSET_CODE
  );

  assert.equal(fx, mockAseFxSvc.defaultRate);
  assert.equal(mockAseFxSvc.getPeerFxFromAse.mock.calls.length, 0);
});

test('PAL Forex Domain - get intra ase rate without exising rate should fetch it from ase', async () => {
  // use mock to ensure that the fx is fetched from ASE
  mock.reset();
  mock.method(mockAseFxSvc, 'getIntraAseFxRate');

  const fx = await fxAggregate.getIntraAseFxRate(
    FX_SOURCE_ASSET_CODE,
    FX_DESTINATION_ASSET_CODE
  );

  assert.equal(fx, mockAseFxSvc.defaultRate);
  assert.equal(mockAseFxSvc.getIntraAseFxRate.mock.calls.length, 1);
});

test('PAL Forex Domain - get intra ase rate a second time should use locally cached fx', async () => {
  // use mock to ensure that the fx is NOT fetched from ASE
  mock.reset();
  mock.method(mockAseFxSvc, 'getIntraAseFxRate');

  const fx = await fxAggregate.getIntraAseFxRate(
    FX_SOURCE_ASSET_CODE,
    FX_DESTINATION_ASSET_CODE
  );

  assert.equal(fx, mockAseFxSvc.defaultRate);
  assert.equal(mockAseFxSvc.getIntraAseFxRate.mock.calls.length, 0);
});

test('PAL Forex Domain - set peer fx rates from ASE', async () => {
  await fxAggregate.setPeerFxRate(
    FX_SOURCE_ASSET_CODE,
    ASSET_CODE,
    PEER_ONE_ID,
    FX_PEER_RATE,
    null
  );
});

test('PAL Forex Domain - get peer rate should return rate set by ase', async () => {
  const rate = await fxAggregate.getPeerFxRate(
    PEER_ONE_ID,
    FX_SOURCE_ASSET_CODE,
    ASSET_CODE
  );

  assert.ok(rate);
  assert.equal(rate, FX_PEER_RATE);
});

// endregion fx

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

  // get the last event and clear the uncommitted events
  const lastEvents = structuredClone(walletAggregate.uncommittedDomainEvents);
  walletAggregate.clearUncommittedDomainEvents();

  const walletCreatedEvt = lastEvents.find(
    (evt) => evt.msgName === WalletAddressCreatedEvent.name
  );

  assert.ok(walletCreatedEvt);
  assert.equal(walletCreatedEvt.aggregateId, createdWalletAddressInternalId);
  assert.ok(walletCreatedEvt.payload);
  assert.equal(walletCreatedEvt.payload.id, createdWalletAddressInternalId);
  assert.equal(walletCreatedEvt.payload.domain, ALIAS_DOMAIN);
  assert.equal(walletCreatedEvt.payload.pathName, ALIAS_PATHNAME);
  assert.equal(walletCreatedEvt.payload.publicName, PUBLIC_NAME);
  assert.equal(walletCreatedEvt.payload.assetCode, ASSET_CODE);
  assert.equal(walletCreatedEvt.payload.assetScale, ASSET_SCALE);
  assert.equal(walletCreatedEvt.payload.isActive, true);
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

  // get the last event and clear the uncommitted events
  const lastEvents = structuredClone(walletAggregate.uncommittedDomainEvents);
  walletAggregate.clearUncommittedDomainEvents();

  const event = lastEvents.find(
    (evt) => evt.msgName === WalletAddressAliasCreatedEvent.name
  );

  assert.ok(event);
  assert.equal(event.aggregateId, createdWalletAddressInternalId);
  assert.ok(event.payload);
  assert.equal(event.payload.walletId, createdWalletAddressInternalId);
  assert.equal(event.payload.domain, null);
  assert.equal(event.payload.pathName, ALIAS_PATHNAME);
});

test('PAL WalletAddress Domain - create wallet address alias with domain', async () => {
  // Must use another domain as the create wallet address test
  // above automatically creates the alias with domain
  await walletAggregate.createWalletAddressAlias(
    'otherdomain.com',
    ALIAS_PATHNAME,
    createdWalletAddressInternalId
  );

  // get the last event and clear the uncommitted events
  const lastEvents = structuredClone(walletAggregate.uncommittedDomainEvents);
  walletAggregate.clearUncommittedDomainEvents();

  const event = lastEvents.find(
    (evt) => evt.msgName === WalletAddressAliasCreatedEvent.name
  );

  assert.ok(event);
  assert.equal(event.aggregateId, createdWalletAddressInternalId);
  assert.ok(event.payload);
  assert.equal(event.payload.walletId, createdWalletAddressInternalId);
  assert.equal(event.payload.domain, 'otherdomain.com');
  assert.equal(event.payload.pathName, ALIAS_PATHNAME);
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

test('PAL WalletAddress Domain - deactivate wallet address', async () => {
  walletAggregate.clearUncommittedDomainEvents();

  await walletAggregate.deactivate(createdWalletAddressInternalId);

  const wallets = await walletAggregate.getWalletAddresses([
    createdWalletAddressInternalId
  ]);

  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].isActive, false);
  assert.equal(walletAggregate.uncommittedDomainEvents.length, 0);
});

test('PAL WalletAddress Domain - deactivate already inactive wallet address should fail', async () => {
  try {
    await walletAggregate.deactivate(createdWalletAddressInternalId);
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof WalletAddressAlreadyInactiveError);
  }
});

test('PAL WalletAddress Domain - deactivate non existing wallet address should fail', async () => {
  try {
    await walletAggregate.deactivate('NON EXISTING');
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof WalletAddressNotFoundError);
  }
});

test('PAL WalletAddress Domain - activate wallet address', async () => {
  walletAggregate.clearUncommittedDomainEvents();

  await walletAggregate.activate(createdWalletAddressInternalId);

  const wallets = await walletAggregate.getWalletAddresses([
    createdWalletAddressInternalId
  ]);

  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].isActive, true);
  assert.equal(walletAggregate.uncommittedDomainEvents.length, 0);
});

test('PAL WalletAddress Domain - activate already active wallet address should fail', async () => {
  try {
    await walletAggregate.activate(createdWalletAddressInternalId);
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof WalletAddressAlreadyActiveError);
  }
});

test('PAL WalletAddress Domain - activate non existing wallet address should fail', async () => {
  try {
    await walletAggregate.activate('NON EXISTING');
    assert.fail();
  } catch (e) {
    assert.ok(e instanceof WalletAddressNotFoundError);
  }
});

//endregion wallet address alias
