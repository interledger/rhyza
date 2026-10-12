'use strict';

import { randomBytes } from 'node:crypto';
import {
  StreamServer,
  type IncomingMoney,
  type StreamCredentials
} from '@interledger/stream-receiver';

export { StreamServer, type IncomingMoney, type StreamCredentials };

export interface ResolvedStreamCredentials {
  paymentIntentId: string;
  sharedSecret: Buffer;
}

export type ResolveStreamCredentials = (
  destinationIlpAddress: string
) => Promise<ResolvedStreamCredentials | undefined>;

export interface FakeStreamCredentials {
  resolveStreamCredentials: ResolveStreamCredentials;
  issueCredentials(paymentIntentId: string): StreamCredentials;
  streamServer: StreamServer;
}

export function createFakeResolveStreamCredentials(
  serverSecret: Buffer = randomBytes(32),
  serverAddress: string = 'test.rafiki'
): FakeStreamCredentials {
  const streamServer = new StreamServer({ serverSecret, serverAddress });
  const byAddress = new Map<string, ResolvedStreamCredentials>();

  return {
    streamServer,
    issueCredentials(paymentIntentId: string): StreamCredentials {
      const credentials = streamServer.generateCredentials({
        paymentTag: paymentIntentId
      });
      byAddress.set(credentials.ilpAddress, {
        paymentIntentId,
        sharedSecret: credentials.sharedSecret
      });
      return credentials;
    },
    async resolveStreamCredentials(
      destinationIlpAddress: string
    ): Promise<ResolvedStreamCredentials | undefined> {
      if (!streamServer.decodePaymentTag(destinationIlpAddress)) {
        return undefined;
      }
      return byAddress.get(destinationIlpAddress);
    }
  };
}
