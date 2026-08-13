import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { KeyObject, randomUUID } from 'node:crypto';
import { IMessage } from 'common-types-lib';
import {
  createHeaders,
  generateTestKeys
} from '@interledger/http-signature-utils';

import { GrantAggregate } from '../src/grant/aggregate';
import { CreateGrantCmd, CreateGrantCmdPayload } from '../src/commands';
import { GrantCreatedEvent, GrantCreateFailedEvent } from '../src/grant/events';
import { AccessAction, AccessType } from '../src/grant/interfaces';
import { MockGrantRepo, MockWalletAddressService } from './mocks';
import { PinoLogger } from 'implementations-lib';

const REQUEST_URL = 'https://auth.example/create';
const REQUEST_METHOD = 'POST';
const REQUEST_BODY = '{}';

// Signs the fixed request url/method/body with the given key, returning the
// resulting headers lower-cased the way they'd arrive on an incoming request.
async function signRequest(
  privateKey: KeyObject,
  keyId: string
): Promise<Record<string, string>> {
  const request = {
    url: REQUEST_URL,
    method: REQUEST_METHOD,
    body: REQUEST_BODY,
    headers: {} as Record<string, string>
  };
  const signatureHeaders = await createHeaders({ request, privateKey, keyId });
  const headers = { ...request.headers, ...signatureHeaders };
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
}

async function signedSignatureData(
  privateKey: KeyObject,
  kid: string
): Promise<CreateGrantCmdPayload['signatureData']> {
  return {
    url: REQUEST_URL,
    method: REQUEST_METHOD,
    body: REQUEST_BODY,
    headers: await signRequest(privateKey, kid),
    kid
  };
}

function makeCreateGrantCmd(
  payload: Partial<CreateGrantCmdPayload> &
    Pick<CreateGrantCmdPayload, 'client' | 'signatureData'>,
  requestId: string = randomUUID()
): CreateGrantCmd {
  return new CreateGrantCmd(
    {
      id: randomUUID(),
      access: [
        { type: AccessType.INCOMING_PAYMENT, actions: [AccessAction.READ] }
      ],
      ...payload
    },
    requestId
  );
}

describe('GrantAggregate.handleBatch', () => {
  let repo: MockGrantRepo;
  let walletAddressService: MockWalletAddressService;
  let aggregate: GrantAggregate;
  let logger: PinoLogger;

  beforeEach(() => {
    repo = new MockGrantRepo();
    logger = new PinoLogger();
    walletAddressService = new MockWalletAddressService();
    aggregate = new GrantAggregate(repo, walletAddressService, logger);
  });

  afterEach(() => {
    mock.restoreAll();
  });

  describe('handleBatch', async () => {
    it('logs an error when it processes an unknown command', async () => {
      const errorMock = mock.method(logger, 'error', () => {});

      const unknownCmd: IMessage = {
        msgDataFormat: 'JSON',
        msgType: 'COMMAND',
        msgId: randomUUID(),
        msgName: 'SomeUnknownCommand',
        msgTimestamp: Date.now(),
        msgTopic: 'auth-commands',
        msgKey: null,
        msgPartition: null,
        msgOffset: null,
        msgBatchId: null,
        payload: {}
      };

      await assert.doesNotReject(() => aggregate.handleBatch([unknownCmd]));

      assert.equal(errorMock.mock.callCount(), 1);
      assert.equal(
        errorMock.mock.calls[0].arguments[0],
        `Received unexpected command: ${unknownCmd.msgName}`
      );
    });

    describe('handleCreateGrantCommand', async () => {
      it('creates a non-interactive grant and issues an access token', async () => {
        const keys = generateTestKeys();
        const cmd = makeCreateGrantCmd({
          client: JSON.stringify(keys.publicKey),
          signatureData: await signedSignatureData(
            keys.privateKey,
            keys.publicKey.kid
          )
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, GrantCreatedEvent.name);
        const payload = (events[0] as GrantCreatedEvent).payload;
        assert.equal(payload.id, cmd.payload.id);
        assert.ok(payload.accessTokenValue);
        assert.ok(payload.accessTokenManagementId);
        assert.equal(payload.accessTokenExpiresIn, 10_000);
        assert.equal(payload.continueId, undefined);
        assert.equal(payload.continueToken, undefined);
        assert.equal(payload.interactionNonce, undefined);
        assert.deepEqual(payload.access, cmd.payload.access);
      });

      it('creates an interactive grant pending continuation for OUTGOING_PAYMENT access', async () => {
        const keys = generateTestKeys();
        const cmd = makeCreateGrantCmd({
          client: JSON.stringify(keys.publicKey),
          signatureData: await signedSignatureData(
            keys.privateKey,
            keys.publicKey.kid
          ),
          access: [
            {
              type: AccessType.OUTGOING_PAYMENT,
              actions: [AccessAction.CREATE]
            }
          ],
          interact: { start: ['REDIRECT'] }
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, GrantCreatedEvent.name);
        const payload = (events[0] as GrantCreatedEvent).payload;
        assert.ok(payload.continueId);
        assert.ok(payload.continueToken);
        assert.ok(payload.interactionNonce);
        assert.equal(payload.accessTokenValue, undefined);
        assert.equal(payload.accessTokenValue, undefined);
        assert.equal(payload.accessTokenManagementId, undefined);
        assert.equal(payload.accessTokenExpiresIn, undefined);
      });

      describe('client key provided through directed identity', () => {
        it('creates the grant when the provided key successfully validates the signature', async () => {
          const clientKeys = generateTestKeys();
          const cmd = makeCreateGrantCmd({
            client: JSON.stringify(clientKeys.publicKey),
            signatureData: await signedSignatureData(
              clientKeys.privateKey,
              clientKeys.publicKey.kid
            )
          });
          const { events } = await aggregate.handleBatch([cmd]);

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, GrantCreatedEvent.name);
          const payload = (events[0] as GrantCreatedEvent).payload;
          assert.equal(payload.id, cmd.payload.id);
        });

        it('fails with UnauthorizedRequestError when the provided key does not validate the signature', async () => {
          const clientKeys = generateTestKeys();
          const signerKeys = generateTestKeys();
          const cmd = makeCreateGrantCmd({
            client: JSON.stringify(clientKeys.publicKey),
            signatureData: await signedSignatureData(
              signerKeys.privateKey,
              clientKeys.publicKey.kid
            )
          });
          const { events } = await aggregate.handleBatch([cmd]);

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, GrantCreateFailedEvent.name);
          const payload = (events[0] as GrantCreateFailedEvent).payload;
          assert.equal(payload.errorName, 'UnauthorizedRequestError');
          assert.equal(payload.grantId, cmd.payload.id);
        });
      });

      describe('client key resolved via wallet address lookup', () => {
        it('resolves the client key and creates the grant', async () => {
          const keys = generateTestKeys();
          const walletAddress = 'https://wallet.example/alice';
          const kid = 'wallet-key';
          walletAddressService.setKeys(walletAddress, [
            { ...keys.publicKey, kid }
          ]);

          const cmd = makeCreateGrantCmd({
            client: walletAddress,
            signatureData: await signedSignatureData(keys.privateKey, kid)
          });
          const { events } = await aggregate.handleBatch([cmd]);

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, GrantCreatedEvent.name);
          const payload = (events[0] as GrantCreatedEvent).payload;
          assert.equal(payload.id, cmd.payload.id);
        });

        it('fails with UnauthorizedRequestError when the wallet address has no matching key', async () => {
          const keys = generateTestKeys();
          const walletAddress = 'https://wallet.example/bob';
          walletAddressService.setKeys(walletAddress, [
            { ...keys.publicKey, kid: 'some-other-key' }
          ]);

          const cmd = makeCreateGrantCmd({
            client: walletAddress,
            signatureData: await signedSignatureData(
              keys.privateKey,
              'wallet-key'
            )
          });
          const { events } = await aggregate.handleBatch([cmd]);

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, GrantCreateFailedEvent.name);
          const payload = (events[0] as GrantCreateFailedEvent).payload;
          assert.equal(payload.errorName, 'UnauthorizedRequestError');
          assert.equal(payload.grantId, cmd.payload.id);
        });

        it('fails with UnauthorizedRequestError when the wallet address has no keys at all', async () => {
          const keys = generateTestKeys();
          const cmd = makeCreateGrantCmd({
            client: 'https://wallet.example/nokeys',
            signatureData: await signedSignatureData(
              keys.privateKey,
              'wallet-key'
            )
          });
          const { events } = await aggregate.handleBatch([cmd]);

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, GrantCreateFailedEvent.name);
          const payload = (events[0] as GrantCreateFailedEvent).payload;
          assert.equal(payload.errorName, 'UnauthorizedRequestError');
        });

        it('fails with UnauthorizedRequestError when the resolved key does not validate the signature', async () => {
          // The request is actually signed by signerKeys, but the wallet
          // address lookup resolves to a different (wrong) public key that
          // happens to share the requested kid.
          const signerKeys = generateTestKeys();
          const wrongKeys = generateTestKeys();
          const walletAddress = 'https://wallet.example/carol';
          const kid = 'wallet-key';
          walletAddressService.setKeys(walletAddress, [
            { ...wrongKeys.publicKey, kid }
          ]);

          const cmd = makeCreateGrantCmd({
            client: walletAddress,
            signatureData: await signedSignatureData(signerKeys.privateKey, kid)
          });
          const { events } = await aggregate.handleBatch([cmd]);

          assert.equal(events.length, 1);
          assert.equal(events[0].msgName, GrantCreateFailedEvent.name);
          const payload = (events[0] as GrantCreateFailedEvent).payload;
          assert.equal(payload.errorName, 'UnauthorizedRequestError');
          assert.equal(payload.grantId, cmd.payload.id);
        });
      });

      it('fails with DuplicateGrantError when a grant with the same id already exists', async () => {
        const keys = generateTestKeys();
        const id = randomUUID();

        await aggregate.handleBatch([
          makeCreateGrantCmd({
            id,
            client: JSON.stringify(keys.publicKey),
            signatureData: await signedSignatureData(
              keys.privateKey,
              keys.publicKey.kid
            )
          })
        ]);

        const { events } = await aggregate.handleBatch([
          makeCreateGrantCmd({
            id,
            client: JSON.stringify(keys.publicKey),
            signatureData: await signedSignatureData(
              keys.privateKey,
              keys.publicKey.kid
            )
          })
        ]);

        assert.equal(events.length, 1);
        assert.equal(events[0].msgName, GrantCreateFailedEvent.name);
        const payload = (events[0] as GrantCreateFailedEvent).payload;
        assert.equal(payload.errorName, 'DuplicateGrantError');
        assert.equal(payload.grantId, id);
      });

      it('carries subjectIds through to the created grant event', async () => {
        const keys = generateTestKeys();
        const subjectIds = [{ format: 'email', id: 'alice@example.com' }];
        const cmd = makeCreateGrantCmd({
          client: JSON.stringify(keys.publicKey),
          signatureData: await signedSignatureData(
            keys.privateKey,
            keys.publicKey.kid
          ),
          subjectIds
        });
        const { events } = await aggregate.handleBatch([cmd]);

        assert.equal(events[0].msgName, GrantCreatedEvent.name);
        const payload = (events[0] as GrantCreatedEvent).payload;
        assert.deepEqual(payload.subjectIds, subjectIds);
      });
    });
  });
});
