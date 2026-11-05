'use strict';

import assert from 'node:assert';
import { describe, test } from 'node:test';
import {
  createFakeResolveStreamCredentials,
  encodeOutgoingStreamPrepare,
  FulfillDispatch,
  ILPPaymentReceivedEvent,
  IlpPeerAggregate,
  IPacketCorrelation,
  IPeer,
  IPeerRepository,
  IPeeringClient,
  PacketDispatch,
  ProcessPreparePacketCmd,
  RejectDispatch
} from '../src';

class InMemoryPeerRepository implements IPeerRepository {
  private readonly _peers = new Map<string, IPeer>();
  private readonly _packets = new Map<string, IPacketCorrelation>();

  constructor(seedPeers: IPeer[] = []) {
    for (const peer of seedPeers) {
      this._peers.set(peer.peerId, peer);
    }
  }

  async fetchById(peerId: string): Promise<IPeer | undefined> {
    return this._peers.get(peerId);
  }
  async fetchAll(): Promise<IPeer[]> {
    return Array.from(this._peers.values());
  }
  async store(peer: IPeer): Promise<void> {
    this._peers.set(peer.peerId, peer);
  }
  async update(peer: IPeer): Promise<void> {
    this._peers.set(peer.peerId, peer);
  }
  async fetchPacketById(
    packetId: string
  ): Promise<IPacketCorrelation | undefined> {
    return this._packets.get(packetId);
  }
  async storePacket(packet: IPacketCorrelation): Promise<void> {
    this._packets.set(packet.packetId, packet);
  }
  async updatePacket(packet: IPacketCorrelation): Promise<void> {
    this._packets.set(packet.packetId, packet);
  }
}

class RecordingPeeringClient implements IPeeringClient {
  readonly rejects: RejectDispatch[] = [];
  readonly fulfills: FulfillDispatch[] = [];

  async dispatch(_input: PacketDispatch): Promise<void> {}
  async dispatchReject(input: RejectDispatch): Promise<void> {
    this.rejects.push(input);
  }
  async dispatchFulfill(input: FulfillDispatch): Promise<void> {
    this.fulfills.push(input);
  }
}

const HTTP = {
  outgoing: {
    endpoint: 'https://peer.example/ilp',
    callbackEndpoint: 'https://peer.example/ilp/callback',
    authToken: 't'
  }
};

describe('maxPacketAmount on inbound prepare', () => {
  async function setup(maxPacketAmount?: string) {
    const fake = createFakeResolveStreamCredentials();
    const credentials = fake.issueCredentials('intent-1');
    const peering = new RecordingPeeringClient();
    const repo = new InMemoryPeerRepository([
      {
        peerId: 'peer-1',
        http: HTTP,
        isActive: true,
        ...(maxPacketAmount !== undefined ? { maxPacketAmount } : {})
      }
    ]);
    const aggregate = new IlpPeerAggregate(
      repo,
      peering,
      fake.resolveStreamCredentials,
      fake.streamServer,
      fake.serverAddress
    );
    return { aggregate, peering, repo, credentials, fake };
  }

  function prepare(
    destinationIlpAddress: string,
    amount: string,
    overrides: Record<string, unknown> = {}
  ) {
    return new ProcessPreparePacketCmd({
      peerId: 'peer-1',
      packetId: 'packet-1',
      destinationIlpAddress,
      amount,
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
      executionCondition: Buffer.alloc(32).toString('base64'),
      ...overrides
    });
  }

  test('over-limit prepare rejects with F08 and amount+limit data', async () => {
    const { aggregate, peering, credentials } = await setup('50');

    const { events } = await aggregate.handleBatch([
      prepare(credentials.ilpAddress, '100')
    ]);

    assert.equal(events.length, 0);
    assert.equal(peering.rejects.length, 1);
    const reject = peering.rejects[0];
    assert.equal(reject.rejectCode, 'F08');
    assert.equal(
      reject.rejectMessage,
      'packet size too large. maxAmount=50 actualAmount=100'
    );
    assert.ok(reject.data);
    const data = Buffer.from(reject.data!, 'base64');
    assert.equal(data.length, 16);
    assert.equal(data.readBigUInt64BE(0), 100n);
    assert.equal(data.readBigUInt64BE(8), 50n);
  });

  test('under-limit prepare is unchanged', async () => {
    const { aggregate, peering, credentials, fake } = await setup('100');
    const resolved = await fake.resolveStreamCredentials(credentials.ilpAddress);
    assert.ok(resolved);
    const encoded = encodeOutgoingStreamPrepare({
      sharedSecret: resolved.sharedSecret,
      minDestinationAmount: '100'
    });

    const { events } = await aggregate.handleBatch([
      prepare(credentials.ilpAddress, '100', {
        data: encoded.data.toString('base64'),
        executionCondition: encoded.executionCondition.toString('base64')
      })
    ]);

    assert.equal(peering.rejects.length, 0);
    assert.equal(events.length, 1);
    assert.equal(events[0].msgName, ILPPaymentReceivedEvent.name);
    assert.equal(
      (events[0] as ILPPaymentReceivedEvent).payload.sourceAmount,
      '100'
    );
  });

  test('absent maxPacketAmount does not reject large prepares', async () => {
    const { aggregate, peering, credentials, fake } = await setup();
    const resolved = await fake.resolveStreamCredentials(credentials.ilpAddress);
    assert.ok(resolved);
    const encoded = encodeOutgoingStreamPrepare({
      sharedSecret: resolved.sharedSecret,
      minDestinationAmount: '999999'
    });

    const { events } = await aggregate.handleBatch([
      prepare(credentials.ilpAddress, '999999', {
        data: encoded.data.toString('base64'),
        executionCondition: encoded.executionCondition.toString('base64')
      })
    ]);

    assert.equal(peering.rejects.length, 0);
    assert.equal(events[0].msgName, ILPPaymentReceivedEvent.name);
  });
});
