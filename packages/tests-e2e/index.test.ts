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

const ADMIN_API_PORT = 3001;
const ADMIN_API_URL = 'http://localhost:' + ADMIN_API_PORT;
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

    const sender = await createWalletAddress(
      assetCode,
      'sender',
      'test sender'
    );
    const receiver = await createWalletAddress(
      assetCode,
      'receiver',
      'test receiver'
    );

    const paymentIntent = await adminClient.paymentIntents.createPaymentIntent({
      walletAddress: receiver.address,
      incomingAmount: 100
    });

    assert.ok(paymentIntent.id);
    const paymentIntentId = paymentIntent.id;

    const quote = await adminClient.quotes.createQuote({
      paymentIntentId,
      walletAddress: sender.address
    });

    assert.ok(quote.id);
    const quoteId = quote.id;

    const payment = await adminClient.payments.createPayment({
      quoteId,
      walletAddress: sender.address,
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

  const createWalletAddress = async (
    assetCode: string,
    pathName: string,
    publicName: string
  ) => {
    const walletAddress = await adminClient.walletAddresses.createWalletAddress(
      {
        assetCode,
        pathName,
        publicName
      }
    );
    assert.ok(walletAddress.id);
    assert.ok(walletAddress.address.endsWith(`/${pathName}`));
    return walletAddress;
  };

  after(async () => {
    await environment?.down();
  });
});
