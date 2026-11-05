'use strict';

import { StreamServer } from '@interledger/stream-receiver';
import { hmac } from '@interledger/stream-receiver/dist/src/utils.js';
import {
  ResolveStreamCredentials,
  ResolvedStreamCredentials
} from 'ilp-domain-lib';

const SHARED_SECRET_GENERATION_STRING = Buffer.from('ilp_stream_shared_secret');

export function createResolveStreamCredentials(options: {
  streamServer: StreamServer;
  serverSecret: Buffer;
  serverAddress: string;
}): ResolveStreamCredentials {
  const sharedSecretKeyGen = hmac(
    options.serverSecret,
    SHARED_SECRET_GENERATION_STRING
  );
  const { streamServer, serverAddress } = options;

  return async (
    destinationIlpAddress: string
  ): Promise<ResolvedStreamCredentials | undefined> => {
    const paymentIntentId = streamServer.decodePaymentTag(
      destinationIlpAddress
    );
    if (typeof paymentIntentId !== 'string' || paymentIntentId.length === 0) {
      return undefined;
    }

    if (!destinationIlpAddress.startsWith(`${serverAddress}.`)) {
      return undefined;
    }

    const localSegment = destinationIlpAddress
      .slice(serverAddress.length + 1)
      .split('.')[0];
    if (!localSegment) {
      return undefined;
    }

    const token = Buffer.from(localSegment, 'base64url');
    const sharedSecret = hmac(sharedSecretKeyGen, token);
    return { paymentIntentId, sharedSecret };
  };
}

export function createStreamServer(options: {
  serverSecret: Buffer;
  serverAddress: string;
}): StreamServer {
  return new StreamServer(options);
}

export function parseStreamServerSecret(raw: string): Buffer {
  const secret = Buffer.from(raw, 'base64url');
  if (secret.byteLength !== 32) {
    throw new Error(
      `STREAM_SERVER_SECRET must decode to 32 bytes (got ${secret.byteLength})`
    );
  }
  return secret;
}

export function requireStreamServerSecret(
  raw: string | undefined = process.env['STREAM_SERVER_SECRET']
): Buffer {
  if (!raw) {
    throw new Error(
      'STREAM_SERVER_SECRET is not set; refusing to start with a default secret'
    );
  }
  return parseStreamServerSecret(raw);
}
