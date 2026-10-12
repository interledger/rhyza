'use strict';

import assert from 'node:assert';
import { describe, test } from 'node:test';
import { ConsoleLogger, IMessage } from 'common-types-lib';
import {
  DispatchPreparePacketCmd,
  ILPPeerCreatedEvent,
  ProcessRejectPacketCmd
} from 'ilp-domain-lib';
import { InMemoryTransportCorrelationStore } from '../src/correlation/in-memory-store';
import { IlpConnector } from '../src/connector';
import { HttpConnectorTransport } from '../src/http-connector-transport';
import { OutboundExpiryWorker } from '../src/outbound-expiry-worker';
import { PeerDirectory } from '../src/peer-directory';
import {
  IConnectorTransport,
  WireFulfill,
  WirePrepare,
  WireReject,
  WireResponse
} from '../src/transport';

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 2_000
): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const prepare = (overrides: Partial<WirePrepare> = {}): WirePrepare => ({
  peerId: 'self',
  packetId: 'packet-1',
  destinationIlpAddress: 'g.us.alice',
  amount: '100',
  expiresAt: new Date(Date.now() + 30_000).toISOString(),
  executionCondition: Buffer.alloc(32).toString('base64'),
  ...overrides
});

const fulfillPacket = (
  p: WirePrepare,
  overrides: Partial<Omit<WireFulfill, 'kind' | 'packetId'>> = {}
): WireFulfill => ({
  kind: 'FULFILL',
  packetId: p.packetId,
  fulfillment: Buffer.alloc(32).toString('base64'),
  ...overrides
});

const rejectPacket = (
  p: WirePrepare,
  overrides: Partial<Omit<WireReject, 'kind' | 'packetId'>> = {}
): WireReject => ({
  kind: 'REJECT',
  packetId: p.packetId,
  rejectCode: 'F99',
  rejectMessage: 'quote response',
  ...overrides
});

async function startSelfLoopTransport(options?: {
  isActive?: boolean;
  outgoingToken?: string;
  incomingToken?: string;
}): Promise<{
  transport: HttpConnectorTransport;
  directory: PeerDirectory;
}> {
  const directory = new PeerDirectory();
  const transport = new HttpConnectorTransport({
    directory,
    port: 0,
    logger: new ConsoleLogger()
  });
  await transport.start();

  const port = transport.boundPort;
  assert.ok(port, 'expected the transport to bind a port');

  directory.upsertFromEvent(
    new ILPPeerCreatedEvent({
      peerId: 'self',
      http: {
        outgoing: {
          endpoint: `http://127.0.0.1:${port}/ilp`,
          callbackEndpoint: `http://127.0.0.1:${port}/ilp/callback`,
          authToken: options?.outgoingToken ?? 'shared-token'
        },
        incoming: { authToken: options?.incomingToken ?? 'shared-token' }
      },
      isActive: options?.isActive ?? true
    })
  );

  return { transport, directory };
}

describe('HttpConnectorTransport — no outgoing config', () => {
  test('rejects locally with T00 without making any network call', async () => {
    const directory = new PeerDirectory();
    const transport = new HttpConnectorTransport({
      directory,
      port: 0
    });
    const responses: WireResponse[] = [];
    transport.onResponse((r) => {
      responses.push(r);
    });

    await transport.sendPrepare(prepare({ peerId: 'peer-unknown' }));
    await waitFor(() => responses.length > 0);

    assert.equal(responses[0].kind, 'REJECT');
    assert.equal((responses[0] as WireReject).rejectCode, 'T00');
  });
});

describe('HttpConnectorTransport — self-loop over real HTTP (async/callback)', () => {
  test('fulfills a round trip when the inbound handler calls sendFulfill', async () => {
    const { transport } = await startSelfLoopTransport();
    try {
      const responses: WireResponse[] = [];
      transport.onResponse((r) => {
        responses.push(r);
      });
      transport.onInboundPrepare(async (p) => {
        await transport.sendFulfill(fulfillPacket(p), p.peerId, p.expiresAt);
      });

      await transport.sendPrepare(prepare());
      await waitFor(() => responses.length > 0);

      assert.equal(responses[0].kind, 'FULFILL');
      assert.equal(responses[0].packetId, 'packet-1');
    } finally {
      await transport.stop();
    }
  });

  test('rejects a round trip when the inbound handler calls sendReject', async () => {
    const { transport } = await startSelfLoopTransport();
    try {
      const responses: WireResponse[] = [];
      transport.onResponse((r) => {
        responses.push(r);
      });
      transport.onInboundPrepare(async (p) => {
        await transport.sendReject(
          rejectPacket(p, {
            data: Buffer.from('opaque-reject-data').toString('base64')
          }),
          p.peerId,
          p.expiresAt
        );
      });

      await transport.sendPrepare(prepare({ packetId: 'packet-2' }));
      await waitFor(() => responses.length > 0);

      assert.equal(responses[0].kind, 'REJECT');
      assert.equal((responses[0] as WireReject).rejectCode, 'F99');
      assert.ok((responses[0] as WireReject).data);
    } finally {
      await transport.stop();
    }
  });

  test('the initial POST returns 202 immediately - sendPrepare does not block on the callback', async () => {
    const { transport } = await startSelfLoopTransport();
    try {
      let respondedAt = 0;
      transport.onInboundPrepare(async (p) => {
        await new Promise((r) => setTimeout(r, 200));
        respondedAt = Date.now();
        await transport.sendFulfill(fulfillPacket(p), p.peerId, p.expiresAt);
      });

      const before = Date.now();
      await transport.sendPrepare(prepare({ packetId: 'packet-async' }));
      const sendPrepareDuration = Date.now() - before;

      assert.ok(
        sendPrepareDuration < 200,
        `expected sendPrepare to resolve on the 202, not wait for the callback (took ${sendPrepareDuration}ms)`
      );
      await waitFor(() => respondedAt > 0);
    } finally {
      await transport.stop();
    }
  });

  test('a mismatched bearer token (401) yields a final F00 reject on the sender side', async () => {
    const { transport } = await startSelfLoopTransport({
      outgoingToken: 'sender-token',
      incomingToken: 'expected-token'
    });
    try {
      const responses: WireResponse[] = [];
      transport.onResponse((r) => {
        responses.push(r);
      });

      await transport.sendPrepare(prepare({ packetId: 'packet-401' }));
      await waitFor(() => responses.length > 0);

      // 4xx per RFC 0035 -> a final error, not a retryable/temporary one.
      assert.equal(responses[0].kind, 'REJECT');
      assert.equal((responses[0] as WireReject).rejectCode, 'F00');
    } finally {
      await transport.stop();
    }
  });

  test('an inactive peer rejects a new prepare with a final F00 (403 on the wire)', async () => {
    const { transport } = await startSelfLoopTransport({ isActive: false });
    try {
      const responses: WireResponse[] = [];
      transport.onResponse((r) => {
        responses.push(r);
      });

      await transport.sendPrepare(prepare({ packetId: 'packet-403' }));
      await waitFor(() => responses.length > 0);

      assert.equal(responses[0].kind, 'REJECT');
      assert.equal((responses[0] as WireReject).rejectCode, 'F00');
    } finally {
      await transport.stop();
    }
  });

  test('a late callback still succeeds after the peer is deactivated in between', async () => {
    const { transport, directory } = await startSelfLoopTransport();
    try {
      let deliverFulfill: (() => Promise<void>) | undefined;
      transport.onInboundPrepare(async (p) => {
        deliverFulfill = () =>
          transport.sendFulfill(fulfillPacket(p), p.peerId, p.expiresAt);
      });

      const responses: WireResponse[] = [];
      transport.onResponse((r) => {
        responses.push(r);
      });

      await transport.sendPrepare(prepare({ packetId: 'packet-late' }));
      await waitFor(() => deliverFulfill !== undefined);

      directory.upsertFromEvent(
        new ILPPeerCreatedEvent({
          peerId: 'self',
          http: {
            outgoing: {
              endpoint: `http://127.0.0.1:${transport.boundPort}/ilp`,
              callbackEndpoint: `http://127.0.0.1:${transport.boundPort}/ilp/callback`,
              authToken: 'shared-token'
            },
            incoming: { authToken: 'shared-token' }
          },
          isActive: false
        })
      );

      await deliverFulfill!();
      await waitFor(() => responses.length > 0);
      assert.equal(responses[0].kind, 'FULFILL');
    } finally {
      await transport.stop();
    }
  });

  test('any replica can deliver an inbound reply using the peer callback endpoint', async () => {
    const { transport } = await startSelfLoopTransport();
    try {
      let capturedPrepare: WirePrepare | undefined;
      transport.onInboundPrepare(async (p) => {
        capturedPrepare = p;
      });

      const responses: WireResponse[] = [];
      transport.onResponse((r) => {
        responses.push(r);
      });

      await transport.sendPrepare(prepare({ packetId: 'packet-replica-b' }));
      await waitFor(() => capturedPrepare !== undefined);

      await transport.sendFulfill(
        fulfillPacket(capturedPrepare!),
        capturedPrepare!.peerId,
        capturedPrepare!.expiresAt
      );
      await waitFor(() => responses.length > 0);

      assert.equal(responses[0].kind, 'FULFILL');
      assert.equal(responses[0].packetId, 'packet-replica-b');
    } finally {
      await transport.stop();
    }
  });

  test('an outbound prepare that never gets a callback times out with R00 at its own expiry', async () => {
    const store = new InMemoryTransportCorrelationStore();
    // Outbound-only stub: simulates 202 without looping back as inbound.
    class OutboundOnlyTransport implements IConnectorTransport {
      private _onOutboundAccepted?: (prepare: WirePrepare) => void;
      async sendPrepare(prepare: WirePrepare): Promise<void> {
        await this._onOutboundAccepted?.(prepare);
      }
      async sendFulfill(): Promise<void> {}
      async sendReject(): Promise<void> {}
      onResponse(): void {}
      onInboundPrepare(): void {}
      onOutboundPrepareAccepted(handler: (prepare: WirePrepare) => void): void {
        this._onOutboundAccepted = handler;
      }
    }
    const transport = new OutboundOnlyTransport();

    const sent: IMessage[] = [];
    const connector = new IlpConnector(
      {
        async send(message) {
          sent.push(...(Array.isArray(message) ? message : [message]));
          return [];
        },
        async sendWithoutAcks(message) {
          await this.send(message);
        },
        async connect() {},
        async disconnect() {},
        async destroy() {}
      },
      transport,
      store
    );
    connector.init();

    const worker = new OutboundExpiryWorker(connector, 10);
    worker.start();

    try {
      await connector.handleConnectorCommands([
        new DispatchPreparePacketCmd({
          peerId: 'peer-1',
          packetId: 'packet-expiring',
          paymentIntentId: 'intent-expiring',
          destinationIlpAddress: 'g.us.alice',
          amount: '100',
          expiresAt: new Date(Date.now() + 50).toISOString(),
          executionCondition: Buffer.alloc(32).toString('base64')
        })
      ]);

      await waitFor(
        () => sent.some((m) => m.msgName === ProcessRejectPacketCmd.name),
        3_000
      );

      const cmd = sent.find(
        (m) => m.msgName === ProcessRejectPacketCmd.name
      ) as ProcessRejectPacketCmd;
      assert.equal(cmd.payload.rejectCode, 'R00');
      assert.equal(cmd.payload.packetId, 'packet-expiring');
      assert.equal(cmd.payload.paymentIntentId, 'intent-expiring');
    } finally {
      worker.stop();
    }
  });
});
