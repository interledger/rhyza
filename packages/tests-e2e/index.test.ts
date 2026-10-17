import assert from 'assert';
import { test, describe, before, after } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import path from 'path';
import {
  DockerComposeEnvironment,
  StartedDockerComposeEnvironment,
  Wait
} from 'testcontainers';
import { AdminApiClient, createAdminClient } from 'admin-client-lib';
import { IlpClient } from 'ilp-client-lib';

const ADMIN_API_PORT = 3001;
const ADMIN_API_URL = 'http://localhost:' + ADMIN_API_PORT;
const ILP_GRPC_URL = 'localhost:50053';
const COMPOSE_FILE = 'docker-compose.yaml';

describe('E2E tests', () => {
  let environment: StartedDockerComposeEnvironment;
  let adminClient: AdminApiClient;
  before(async () => {
    const composeDir = path.resolve(__dirname, '../../docker');
    environment = await new DockerComposeEnvironment(composeDir, COMPOSE_FILE)
      .withEnvironment({
        WEBHOOK_URL: 'http://ase-mock-service:3000/webhooks'
      })
      .withWaitStrategy(
        'ase-mock-service',
        Wait.forHttp('/healthz', ADMIN_API_PORT)
      )
      .up();

    adminClient = createAdminClient(ADMIN_API_URL);
  });

  test('Local', async () => {
    const assetCode = 'USD';
    const asset = await adminClient.assets.createAsset({
      code: assetCode,
      scale: 2
    });
    assert.equal(asset.code, assetCode);

    const senderAddress = 'test.com/sender';
    await createWalletAddress(assetCode, senderAddress, 'test sender');

    const receiverAddress = 'test.com/receiver';
    await createWalletAddress(assetCode, receiverAddress, 'test receiver');

    const paymentIntent = await adminClient.paymentIntents.createPaymentIntent({
      walletAddress: receiverAddress,
      incomingAmount: 100
    });

    assert.ok(paymentIntent.id);
    const paymentIntentId = paymentIntent.id;

    const quote = await adminClient.quotes.createQuote({
      paymentIntentId,
      walletAddress: senderAddress
    });

    assert.ok(quote.id);
    const quoteId = quote.id;

    const payment = await adminClient.payments.createPayment({
      quoteId,
      walletAddress: senderAddress,
      paymentIntentId
    });

    assert.ok(payment.id);
    const paymentId = payment.id;

    // Wait 2 seconds for ase-mock-service to receive the webhook and approve payment
    await setTimeout(2000);

    const paymentFound = await adminClient.payments.getPayment(
      paymentIntentId,
      paymentId
    );
    assert.equal(paymentFound.id, paymentId);
    assert.equal(paymentFound.state, 'COMPLETED');
  });

  test('Peer deactivation', async () => {
    const peerId = 'e2e-deactivated-peer';
    await adminClient.assets.createAsset({ code: 'EUR', scale: 2 });
    await adminClient.peers.createPeer({
      id: peerId,
      name: 'E2E deactivated peer',
      assetCode: 'EUR',
      assetScale: 2,
      ilpStaticAddress: 'test.e2e-deactivated-peer',
      http: {
        outgoing: { endpoint: 'http://localhost:3999', authToken: 'e2e-token' }
      }
    });

    await adminClient.peers.deactivatePeer(peerId);

    // The deactivation reaches the ILP service through an event, so wait for it.
    const ilpClient = new IlpClient(ILP_GRPC_URL);
    await ilpClient.init();
    try {
      const deadline = Date.now() + 30_000;
      let ilpPeer = await ilpClient.getPeer(peerId);
      while (ilpPeer?.isActive !== false && Date.now() < deadline) {
        await setTimeout(500);
        ilpPeer = await ilpClient.getPeer(peerId);
      }
      assert.equal(ilpPeer?.isActive, false);
    } finally {
      await ilpClient.disconnect();
    }

    await assert.rejects(
      adminClient.peers.deactivatePeer(peerId),
      (err: { response?: Response }) => err.response?.status === 409
    );
    await assert.rejects(
      adminClient.peers.deactivatePeer('e2e-no-such-peer'),
      (err: { response?: Response }) => err.response?.status === 404
    );
  });

  const createWalletAddress = async (
    assetCode: string,
    address: string,
    publicName: string
  ) => {
    const walletAddress = await adminClient.walletAddresses.createWalletAddress(
      {
        assetCode,
        address,
        publicName
      }
    );
    assert.ok(walletAddress.id);
    assert.equal(walletAddress.address, address);
  };

  after(async () => {
    await environment?.down();
  });
});
