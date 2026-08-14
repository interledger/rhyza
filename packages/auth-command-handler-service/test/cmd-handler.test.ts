'use strict';

import assert from 'node:assert';
import { describe, test } from 'node:test';
import { KeyObject, randomUUID } from 'node:crypto';
import {
  createHeaders,
  generateTestKeys
} from '@interledger/http-signature-utils';
import {
  ConsoleLogger,
  IMessage,
  IMessageConsumer,
  IMessageProducer,
  IMessageProducerAcks
} from 'common-types-lib';
import {
  CreateGrantCmd,
  CreateGrantCmdPayload,
  GrantAggregate,
  GrantCreatedEvent,
  IGrant,
  IGrantRepository,
  IJsonWebKey,
  IWalletAddressService
} from 'auth-domain-lib';
import { AuthCommandHandler } from '../src/cmd-handler';
import { PinoLogger } from '../../implementations-lib/dist';

class MockProducer implements IMessageProducer {
  readonly sent: IMessage[] = [];
  async send(message: IMessage | IMessage[]): Promise<IMessageProducerAcks[]> {
    this.sent.push(...(Array.isArray(message) ? message : [message]));
    return [];
  }
  async sendWithoutAcks(message: IMessage | IMessage[]): Promise<void> {
    await this.send(message);
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async destroy(): Promise<void> {}
}

// Captures the batch callback the handler registers and lets the test push
// batches through it, standing in for the Kafka consumer.
class MockConsumer implements IMessageConsumer {
  private _batchCb?: (messages: IMessage[]) => Promise<void>;
  setCallbackFn(): void {}
  setBatchCallbackFn(cb: (messages: IMessage[]) => Promise<void>): void {
    this._batchCb = cb;
  }
  setFilteringFn(): void {}
  setTopics(): void {}
  setBatchSize(): void {}
  async destroy(): Promise<void> {}
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async start(): Promise<void> {}
  async startAndWaitForRebalance(): Promise<void> {}
  async stop(): Promise<void> {}
  async deliver(messages: IMessage[]): Promise<void> {
    await this._batchCb?.(messages);
  }
}

class InMemoryGrantRepo implements IGrantRepository {
  private _store = new Map<string, IGrant>();
  async storeMany(grants: IGrant[]): Promise<void> {
    for (const grant of grants) this._store.set(grant.id, grant);
  }
  async fetchById(id: string): Promise<IGrant | undefined> {
    return this._store.get(id);
  }
  async fetchByIds(ids: string[]): Promise<IGrant[]> {
    return ids.flatMap((id) => {
      const grant = this._store.get(id);
      return grant ? [grant] : [];
    });
  }
}

class NullWalletAddressService implements IWalletAddressService {
  async getWalletAddressKeys(): Promise<IJsonWebKey[]> {
    return [];
  }
}

async function startedHandler() {
  const producer = new MockProducer();
  const consumer = new MockConsumer();
  const aggregate = new GrantAggregate(
    new InMemoryGrantRepo(),
    new NullWalletAddressService(),
    new PinoLogger()
  );
  const handler = new AuthCommandHandler(
    consumer,
    producer,
    aggregate,
    new ConsoleLogger()
  );
  await handler.start();
  return { producer, consumer };
}

const REQUEST_URL = 'https://auth.example/create';
const REQUEST_METHOD = 'POST';
const REQUEST_BODY = '{}';

async function signedSignatureData(
  privateKey: KeyObject,
  kid: string
): Promise<CreateGrantCmdPayload['signatureData']> {
  const request = {
    url: REQUEST_URL,
    method: REQUEST_METHOD,
    body: REQUEST_BODY,
    headers: {} as Record<string, string>
  };
  const signatureHeaders = await createHeaders({
    request,
    privateKey,
    keyId: kid
  });
  const headers: Record<string, string> = {
    ...request.headers,
    ...signatureHeaders
  };
  return {
    url: REQUEST_URL,
    method: REQUEST_METHOD,
    body: REQUEST_BODY,
    headers: Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
    ) as Record<string, string>,
    kid
  };
}

describe('AuthCommandHandler — grant creation', () => {
  test('CreateGrantCmd for a non-interactive grant yields GrantCreatedEvent', async () => {
    const { producer, consumer } = await startedHandler();
    const keys = generateTestKeys();

    const commandPayloadId = randomUUID();
    const requestId = randomUUID();
    await consumer.deliver([
      new CreateGrantCmd(
        {
          id: commandPayloadId,
          client: JSON.stringify(keys.publicKey),
          signatureData: await signedSignatureData(
            keys.privateKey,
            keys.publicKey.kid
          ),
          access: [{ type: 'INCOMING_PAYMENT', actions: ['READ'] }]
        },
        requestId
      )
    ]);

    const event = producer.sent.find(
      (m) => m.msgName === GrantCreatedEvent.name
    ) as GrantCreatedEvent;
    assert.ok(event, 'expected a GrantCreatedEvent');
    assert.equal(event.payload.id, commandPayloadId);
    assert.equal(event.requestId, requestId);
  });
});
