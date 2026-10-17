import { before, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { NullLogger } from 'common-types-lib';
import { IPalJsonWebKeyDto } from 'pal-public-types-lib';
import {
  DuplicateWalletAddressKeyError,
  InvalidWalletAddressJwkError,
  IPalWalletAddressRepository,
  WalletAddressAggregate,
  WalletAddressKeyAlreadyRevokedError,
  WalletAddressKeyNotFoundError,
  WalletAddressNotFoundError
} from '../src';
import { MockWalletRepo } from './mocks';

const logger = new NullLogger();

const VALID_JWK: IPalJsonWebKeyDto = {
  kid: 'key-1',
  alg: 'EdDSA',
  kty: 'OKP',
  crv: 'Ed25519',
  x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo'
};

let walletRepo: IPalWalletAddressRepository;
let walletAggregate: WalletAddressAggregate;
let walletId: string;

before(async () => {
  walletRepo = new MockWalletRepo();
  walletAggregate = new WalletAddressAggregate(walletRepo, logger);

  walletId = 'wallet-1';
  await walletRepo.store({
    id: walletId,
    publicName: 'Sarah',
    assetCode: 'USD',
    assetScale: 2,
    isActive: true,
    aliases: [{ domain: 'example.com', pathName: 'sarah', walletId: walletId }]
  });
});

test('PAL WalletAddress Keys - add key for existing wallet', async () => {
  const keyId = await walletAggregate.addWalletAddressKey(walletId, VALID_JWK);

  assert.ok(keyId);
  const keys = await walletAggregate.getWalletAddressKeys(walletId);
  assert.equal(keys.length, 1);
  assert.equal(keys[0].id, keyId);
  assert.equal(keys[0].walletAddressId, walletId);
  assert.equal(keys[0].jwk.kid, VALID_JWK.kid);
  assert.equal(keys[0].jwk.x, VALID_JWK.x);
  assert.equal(keys[0].revoked, false);
  assert.equal(keys[0].revokedAt, undefined);
});

test('PAL WalletAddress Keys - add key for missing wallet should fail', async () => {
  await assert.rejects(
    () => walletAggregate.addWalletAddressKey('missing-wallet', VALID_JWK),
    WalletAddressNotFoundError
  );
});

test('PAL WalletAddress Keys - reject invalid jwk', async () => {
  await assert.rejects(
    () =>
      walletAggregate.addWalletAddressKey(walletId, {
        ...VALID_JWK,
        alg: 'RS256'
      }),
    InvalidWalletAddressJwkError
  );
});

test('PAL WalletAddress Keys - reject duplicate kid on same wallet', async () => {
  await assert.rejects(
    () => walletAggregate.addWalletAddressKey(walletId, VALID_JWK),
    DuplicateWalletAddressKeyError
  );
});

test('PAL WalletAddress Keys - allow a second kid on the same wallet', async () => {
  const keyId = await walletAggregate.addWalletAddressKey(walletId, {
    ...VALID_JWK,
    kid: 'key-2'
  });

  assert.ok(keyId);
  const keys = await walletAggregate.getWalletAddressKeys(walletId);
  assert.equal(keys.length, 2);
});

test('PAL WalletAddress Keys - get keys for wallet with none returns empty list', async () => {
  const otherWalletId = 'wallet-empty';
  await walletRepo.store({
    id: otherWalletId,
    publicName: 'Empty',
    assetCode: 'USD',
    assetScale: 2,
    isActive: true,
    aliases: []
  });

  const keys = await walletAggregate.getWalletAddressKeys(otherWalletId);
  assert.equal(keys.length, 0);
});

test('PAL WalletAddress Keys - revoke key keeps the record and stamps revokedAt', async () => {
  const [key] = (await walletAggregate.getWalletAddressKeys(walletId)).filter(
    (item) => item.jwk.kid === VALID_JWK.kid
  );
  assert.ok(key);

  await walletAggregate.revokeWalletAddressKey(walletId, key.id);

  const keys = await walletAggregate.getWalletAddressKeys(walletId);
  const revoked = keys.find((item) => item.id === key.id);
  assert.ok(revoked);
  assert.equal(revoked.revoked, true);
  assert.ok(revoked.revokedAt instanceof Date);
  assert.equal(keys.length, 2);
});

test('PAL WalletAddress Keys - revoke throws when the key is already revoked', async () => {
  const [key] = (await walletAggregate.getWalletAddressKeys(walletId)).filter(
    (item) => item.jwk.kid === VALID_JWK.kid
  );
  assert.ok(key?.revokedAt);
  const revokedAt = key.revokedAt.getTime();

  await assert.rejects(
    () => walletAggregate.revokeWalletAddressKey(walletId, key.id),
    WalletAddressKeyAlreadyRevokedError
  );

  const [again] = (await walletAggregate.getWalletAddressKeys(walletId)).filter(
    (item) => item.id === key.id
  );
  assert.equal(again.revoked, true);
  assert.equal(again.revokedAt?.getTime(), revokedAt);
});

test('PAL WalletAddress Keys - revoke missing key should fail', async () => {
  await assert.rejects(
    () => walletAggregate.revokeWalletAddressKey(walletId, 'missing-key'),
    WalletAddressKeyNotFoundError
  );
});
