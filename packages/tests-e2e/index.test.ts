import assert from 'assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { test, describe, before, after, type TestContext } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import path from 'path';
import {
  DockerComposeEnvironment,
  StartedDockerComposeEnvironment,
  Wait
} from 'testcontainers';
import { AdminApiClient, createAdminClient } from 'admin-client-lib';

const ADMIN_API_PORT = 3001;
const NODE_B_ADMIN_API_PORT = 4001;
const ASE_MOCK_PORT = 3000;
const ADMIN_API_URL = 'http://localhost:' + ADMIN_API_PORT;
const NODE_B_ADMIN_API_URL = 'http://localhost:' + NODE_B_ADMIN_API_PORT;
const NODE_A_PEER_ID = '9f3c1e2a-4b5d-4c6e-8a7f-1b2c3d4e5f60';
const NODE_B_PEER_ID = '04978037-26b8-4b4d-854a-278ed7548959';
const COMPOSE_FILE = 'docker-compose.e2e.yaml';

const composeDir = path.resolve(__dirname, '../../docker');
const composeProject = process.env.E2E_COMPOSE_PROJECT;
const composeLogsPath = process.env.E2E_COMPOSE_LOGS_PATH;
const keepStack = process.env.E2E_KEEP === '1';

describe('E2E tests', () => {
  let environment: StartedDockerComposeEnvironment;
  let adminClient: AdminApiClient;
  before(async () => {
    let environmentBuilder = new DockerComposeEnvironment(
      composeDir,
      COMPOSE_FILE
    )
      .withAutoCleanup(false)
      .withEnvironment({
        WEBHOOK_URL: 'http://ase-mock-service:3000/webhooks',
        ...(process.env.VERSION ? { VERSION: process.env.VERSION } : {})
      });

    if (composeProject) {
      environmentBuilder = environmentBuilder.withProjectName(composeProject);
    }

    // Two nodes can take longer than the 60s default.
    environmentBuilder = environmentBuilder.withStartupTimeout(180_000);

    environmentBuilder = environmentBuilder.withWaitStrategy(
      'ase-mock-service',
      Wait.forHttp('/healthz', ASE_MOCK_PORT)
    );

    environmentBuilder = environmentBuilder.withWaitStrategy(
      'ase-mock-service-b',
      Wait.forHttp('/healthz', ASE_MOCK_PORT)
    );

    // Release override sets pull_policy: never and clears build, so a missing
    // local image fails instead of building from source or pulling from a registry.
    try {
      environment = await environmentBuilder.up();
    } catch (error) {
      dumpComposeLogs();
      throw error;
    }

    adminClient = createAdminClient(ADMIN_API_URL);
  });

  test('Local', async (t) => {
    const assetCode = 'USD';
    const progress = { failed: false };
    let senderAddress = '';
    let receiverAddress = '';
    let paymentIntentId = '';
    let quoteId = '';
    let paymentId = '';

    await step(t, progress, 'create asset', async () => {
      const asset = await adminClient.assets.createAsset({
        code: assetCode,
        scale: 2
      });
      assert.equal(asset.code, assetCode);
    });

    await step(t, progress, 'create sender wallet', async () => {
      const sender = await createWalletAddress(
        adminClient,
        assetCode,
        'sender',
        'test sender'
      );
      senderAddress = sender.address;
    });

    await step(t, progress, 'create receiver wallet', async () => {
      const receiver = await createWalletAddress(
        adminClient,
        assetCode,
        'receiver',
        'test receiver'
      );
      receiverAddress = receiver.address;
    });

    await step(t, progress, 'create payment intent', async () => {
      const paymentIntent =
        await adminClient.paymentIntents.createPaymentIntent({
          walletAddress: receiverAddress,
          incomingAmount: 100
        });
      assert.ok(paymentIntent.id);
      paymentIntentId = paymentIntent.id;
    });

    await step(t, progress, 'create quote', async () => {
      const quote = await adminClient.quotes.createQuote({
        paymentIntentId,
        walletAddress: senderAddress
      });
      assert.ok(quote.id);
      quoteId = quote.id;
    });

    await step(t, progress, 'create payment', async () => {
      const payment = await adminClient.payments.createPayment({
        quoteId,
        walletAddress: senderAddress,
        paymentIntentId
      });
      assert.ok(payment.id);
      paymentId = payment.id;
    });

    await step(t, progress, 'payment completes', async () => {
      // Wait 2 seconds for ase-mock-service to receive the webhook and approve payment
      await setTimeout(2000);

      const paymentFound = await adminClient.payments.getPayment(
        paymentIntentId,
        paymentId
      );
      assert.equal(paymentFound.id, paymentId);
      assert.equal(paymentFound.state, 'COMPLETED');
    });
  });

  test('Remote', async (t) => {
    const assetCode = 'USD';
    const incomingAmount = 1000;
    const progress = { failed: false };
    const adminClientB = createAdminClient(NODE_B_ADMIN_API_URL);
    let senderAddress = '';
    let receiverAddress = '';
    let paymentIntentUrl = '';
    let quoteId = '';
    let quotePaymentIntentId = '';
    let paymentId = '';

    await step(t, progress, 'create node A asset', async () => {
      await createAsset(adminClient, assetCode);
    });

    await step(t, progress, 'create node B asset', async () => {
      await createAsset(adminClientB, assetCode);
    });

    await step(t, progress, 'create sender wallet', async () => {
      const sender = await createWalletAddress(
        adminClient,
        assetCode,
        'remote-sender',
        'Sender (Node A)'
      );
      senderAddress = sender.address;
    });

    await step(t, progress, 'create receiver wallet', async () => {
      const receiver = await createWalletAddress(
        adminClientB,
        assetCode,
        'remote-receiver',
        'Receiver (Node B)'
      );
      receiverAddress = receiver.address;
    });

    await step(t, progress, 'create peer for node B', async () => {
      const peerForB = await adminClient.peers.createPeer({
        id: NODE_B_PEER_ID,
        name: 'Node B',
        assetCode,
        assetScale: 2,
        ilpStaticAddress: 'private.rhyza.b',
        http: {
          outgoing: {
            endpoint: 'http://ilp-connector-service-b:4000/ilp',
            callbackEndpoint:
              'http://ilp-connector-service-b:4000/ilp/callback',
            authToken: 'local-peer-token'
          },
          incoming: { authToken: 'local-peer-token' }
        }
      });
      assert.equal(peerForB.id, NODE_B_PEER_ID);
    });

    await step(t, progress, 'create peer for node A', async () => {
      const peerForA = await adminClientB.peers.createPeer({
        id: NODE_A_PEER_ID,
        name: 'Node A',
        assetCode,
        assetScale: 2,
        ilpStaticAddress: 'private.rhyza.a',
        http: {
          outgoing: {
            endpoint: 'http://ilp-connector-service:4000/ilp',
            callbackEndpoint: 'http://ilp-connector-service:4000/ilp/callback',
            authToken: 'local-peer-token'
          },
          incoming: { authToken: 'local-peer-token' }
        }
      });
      assert.equal(peerForA.id, NODE_A_PEER_ID);
    });

    await step(t, progress, 'fund sender liquidity', async () => {
      const deposit = await adminClient.liquidity.liquidityDeposit({
        assetCode,
        peerId: NODE_B_PEER_ID,
        amount: 100000,
        amountScale: 2
      });
      assert.ok(deposit.id);
    });

    await step(t, progress, 'create payment intent', async () => {
      const paymentIntent =
        await adminClientB.paymentIntents.createPaymentIntent({
          walletAddress: receiverAddress,
          incomingAmount
        });
      assert.ok(paymentIntent.id);
      assert.ok(paymentIntent.openPaymentsUrl);
      paymentIntentUrl = paymentIntent.openPaymentsUrl;
    });

    await step(t, progress, 'create quote', async () => {
      const quote = await adminClient.quotes.createQuote({
        walletAddress: senderAddress,
        paymentIntentUrl,
        debitAmount: String(incomingAmount)
      });
      assert.ok(quote.id);
      assert.ok(quote.paymentIntentId);
      quoteId = quote.id;
      quotePaymentIntentId = quote.paymentIntentId;
    });

    await step(t, progress, 'create payment', async () => {
      const payment = await adminClient.payments.createPayment({
        walletAddress: senderAddress,
        paymentIntentId: quotePaymentIntentId,
        quoteId
      });
      assert.ok(payment.id);
      paymentId = payment.id;
    });

    await step(t, progress, 'payment completes', async () => {
      const deadline = Date.now() + 30000;
      let paymentFound = await adminClient.payments.getPayment(
        quotePaymentIntentId,
        paymentId
      );
      while (paymentFound.state !== 'COMPLETED' && Date.now() < deadline) {
        await setTimeout(500);
        paymentFound = await adminClient.payments.getPayment(
          quotePaymentIntentId,
          paymentId
        );
      }
      assert.equal(paymentFound.id, paymentId);
      assert.equal(paymentFound.state, 'COMPLETED');
    });
  });

  const createWalletAddress = async (
    client: AdminApiClient,
    assetCode: string,
    pathName: string,
    publicName: string
  ) => {
    const walletAddress = await client.walletAddresses.createWalletAddress({
      assetCode,
      pathName,
      publicName
    });
    assert.ok(walletAddress.id);
    assert.ok(walletAddress.address.endsWith(`/${pathName}`));
    return walletAddress;
  };

  const createAsset = async (client: AdminApiClient, code: string) => {
    try {
      const asset = await client.assets.createAsset({ code, scale: 2 });
      assert.equal(asset.code, code);
    } catch (error) {
      const status =
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        error.response instanceof Response
          ? error.response.status
          : undefined;
      if (status !== 409) {
        throw error;
      }
    }
  };

  after(async () => {
    dumpComposeLogs();
    if (keepStack) {
      console.log(
        'Leaving Compose containers, network, and volumes in place (--keep)'
      );
      return;
    }
    await environment?.down();
  });
});

async function step(
  t: TestContext,
  progress: { failed: boolean },
  name: string,
  fn: () => Promise<void>
): Promise<void> {
  if (progress.failed) {
    await t.test(name, { skip: 'previous step failed' }, () => {});
    return;
  }

  await t.test(name, async () => {
    try {
      await fn();
    } catch (error) {
      progress.failed = true;
      throw error;
    }
  });
}

function dumpComposeLogs(): void {
  if (!composeLogsPath || !composeProject) {
    return;
  }

  try {
    const args = ['compose', '-p', composeProject];
    args.push('-f', COMPOSE_FILE);
    args.push('logs', '--no-color');

    const logs = execFileSync('docker', args, {
      cwd: composeDir,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 50 * 1024 * 1024
    });
    writeFileSync(composeLogsPath, logs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeFileSync(composeLogsPath, `Failed to dump compose logs: ${message}\n`);
  }
}
