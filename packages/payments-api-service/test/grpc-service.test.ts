'use strict';

import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';
import {
  ILogger,
  IMessage,
  IMessageConsumer,
  IMessageProducer
} from 'common-types-lib';
import { CreatePaymentIntentRequest } from 'payments-public-types-lib';
import {
  CreatePaymentIntentCmd,
  IPaymentIntentRepository
} from 'payments-domain-lib';
import { PaymentsServiceServer } from '../src/grpc/grpc-service.js';

const noop = () => {};
const logger = {
  child: () => logger,
  isDebugEnabled: () => false,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop
} as unknown as ILogger;

/** Exposes the private unary handler so tests can invoke it as gRPC would. */
type UnaryHandler = {
  _handleUnary(
    call: Partial<ServerUnaryCall<unknown, unknown>>,
    callback: sendUnaryData<unknown>
  ): Promise<void>;
};

/** Builds a server whose producer records every message sent to it. */
const createServer = () => {
  const sent: IMessage[] = [];
  const producer = {
    send: async (msg: IMessage) => {
      sent.push(msg);
      return [];
    }
  } as unknown as IMessageProducer;
  const consumer = {
    setBatchCallbackFn: noop
  } as unknown as IMessageConsumer;
  // 1ms response timeout so the pending-response timer doesn't hold the test open
  const server = new PaymentsServiceServer(
    'test-instance',
    'localhost:0',
    producer,
    consumer,
    {} as IPaymentIntentRepository,
    logger,
    1
  );
  return { server, sent };
};

const callUnary = (server: PaymentsServiceServer, request: unknown) =>
  (server as unknown as UnaryHandler)._handleUnary(
    { request, getDeadline: () => Infinity },
    noop
  );

const buildRequest = () => {
  const req = new CreatePaymentIntentRequest();
  req.setId(randomUUID());
  req.setWalletAddressId('wallet-1');
  req.setWalletAddress('https://example.com/alice');
  return req;
};

describe('CreatePaymentIntentRequest handler', () => {
  test('leaves incomingAmount undefined when the request omits it', async () => {
    const { server, sent } = createServer();

    await callUnary(server, buildRequest());

    assert.equal(sent.length, 1);
    assert.ok(sent[0] instanceof CreatePaymentIntentCmd);
    assert.equal(sent[0].payload.incomingAmount, undefined);
  });

  test('passes incomingAmount through when the request sets it', async () => {
    const { server, sent } = createServer();
    const req = buildRequest();
    req.setIncomingAmount(500);

    await callUnary(server, req);

    assert.equal(sent[0].payload.incomingAmount, 500);
  });
});
