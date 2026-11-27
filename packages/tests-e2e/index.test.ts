import assert from 'assert';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { test, describe, before, after, type TestContext } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import path from 'path';
import {
  DockerComposeEnvironment,
  StartedDockerComposeEnvironment,
  Wait
} from 'testcontainers';
import {
  AdminApiClient,
  createAdminClient,
  PeerCreate
} from 'admin-client-lib';
import { PinoLogger } from 'implementations-lib';
import {
  AuthenticatedClient,
  createAuthenticatedClient,
  createUnauthenticatedClient,
  IncomingPayment,
  isFinalizedGrantWithAccessToken,
  isPendingGrant,
  OpenPaymentsClientError,
  OutgoingPayment,
  PendingGrant,
  Quote,
  WalletAddress
} from '@interledger/open-payments';

const ADMIN_API_PORT = 3001;
const OPEN_PAYMENTS_URL = 'http://localhost:3002';
const OPEN_PAYMENTS_AUTH_URL = 'http://localhost:3003';
const IDP_INTERACTION_URL = 'http://localhost:3004';
const NODE_B_OPEN_PAYMENTS_URL = 'http://localhost:4002';
const NODE_B_OPEN_PAYMENTS_AUTH_URL = 'http://localhost:4003';
const IDP_SECRET = 'idp-secret';
const CLIENT_FINISH_URI = 'http://localhost:3344/finish'; // Never called: the test reads interact_ref from the finish redirect itself.
const CONTINUE_WAIT_MS = 5_500;
const NODE_B_ADMIN_API_PORT = 4001;
const ADMIN_API_URL = 'http://localhost:' + ADMIN_API_PORT;
const NODE_B_ADMIN_API_URL = 'http://localhost:' + NODE_B_ADMIN_API_PORT;
const NODE_A_PEER_ID = '9f3c1e2a-4b5d-4c6e-8a7f-1b2c3d4e5f60';
const NODE_B_PEER_ID = '04978037-26b8-4b4d-854a-278ed7548959';
const COMPOSE_FILE = 'docker-compose.e2e.yaml';
// Kafka consumers on the request paths the tests use, on both nodes.
const KAFKA_CONSUMER_CONTAINERS = [
  'payments-api-service-1',
  'payments-command-handler-service-1',
  'ilp-api-service-1',
  'auth-api-service-1',
  'auth-command-handler-service-1',
  'payments-api-service-b-1',
  'payments-command-handler-service-b-1',
  'ilp-api-service-b-1'
];
// PAL's event handler turns a created asset into its ledger. It sets up its
// consumers one after another (~10s), and a ledger requested before that is
// late: a peer created in the gap fails with "Ledger not found".
const PAL_EVENT_HANDLER_CONTAINERS = [
  'pal-event-handler-service-1',
  'pal-event-handler-service-b-1'
];

const composeDir = path.resolve(__dirname, '../../docker');
const composeProject = process.env.E2E_COMPOSE_PROJECT;
const composeLogsPath = process.env.E2E_COMPOSE_LOGS_PATH;
const keepStack = process.env.E2E_KEEP === '1';
const logger = new PinoLogger({ appName: 'tests-e2e' });

describe('E2E tests', () => {
  const assetCode = 'USD';
  const nativeFetch = globalThis.fetch;
  let environment: StartedDockerComposeEnvironment;
  let adminClient: AdminApiClient;
  let adminClientB: AdminApiClient;
  let openPaymentsClient: AuthenticatedClient;

  before(async () => {
    let environmentBuilder = new DockerComposeEnvironment(
      composeDir,
      COMPOSE_FILE
    )
      .withAutoCleanup(!keepStack)
      .withEnvironment({
        WEBHOOK_URL: 'http://ase-mock-service:3000/webhooks',
        ...(process.env.VERSION ? { VERSION: process.env.VERSION } : {}),
        ...(process.env.TARGET_ARCH
          ? { TARGET_ARCH: process.env.TARGET_ARCH }
          : {})
      });

    if (composeProject) {
      environmentBuilder = environmentBuilder.withProjectName(composeProject);
    }

    // Two nodes can take longer than the 60s default.
    environmentBuilder = environmentBuilder.withStartupTimeout(180_000);

    const containerEvents = startContainerEventWatch();
    logger.info(
      `Starting Compose stack (${COMPOSE_FILE}${composeProject ? `, project ${composeProject}` : ''})`
    );
    try {
      environmentBuilder = environmentBuilder
        .withWaitStrategy(
          'admin-api-service-1',
          Wait.forLogMessage('AdminApiService start complete')
        )
        .withWaitStrategy(
          'admin-api-service-b-1',
          Wait.forLogMessage('AdminApiService start complete')
        )
        .withWaitStrategy(
          'open-payments-resource-service-1',
          Wait.forLogMessage('OpenPaymentsResourceServer start complete')
        )
        .withWaitStrategy(
          'open-payments-auth-service-1',
          Wait.forLogMessage('OpenPaymentsAuthServer start complete')
        )
        .withWaitStrategy(
          'idp-interaction-service-1',
          Wait.forLogMessage('IdpInteractionServer start complete')
        );
      // "start complete" logs before the Kafka consumers get partitions. A
      // request sent in that gap never gets its reply and times out at 120s.
      for (const container of KAFKA_CONSUMER_CONTAINERS) {
        environmentBuilder = environmentBuilder.withWaitStrategy(
          container,
          Wait.forLogMessage('Assign partitions')
        );
      }
      for (const container of PAL_EVENT_HANDLER_CONTAINERS) {
        environmentBuilder = environmentBuilder.withWaitStrategy(
          container,
          Wait.forLogMessage(
            'PalLedgerEventHandlerService started successfully'
          )
        );
      }
      environment = await environmentBuilder.up();
      logger.info('Compose stack is up');
    } catch (error) {
      const recorded = containerEvents.recorded();
      logger.error(
        `Containers that died or restarted before removal:\n${recorded || '(none)'}`
      );
      dumpComposeLogs();
      throw error;
    } finally {
      containerEvents.stop();
    }

    adminClient = createAdminClient(ADMIN_API_URL);
    adminClientB = createAdminClient(NODE_B_ADMIN_API_URL);
    logger.info('Setting up nodes');
    await setUpNodes(adminClient, adminClientB);

    logger.info('Setting up Open Payments client');
    openPaymentsClient = await setUpOpClient({
      admin: adminClient,
      openPaymentsUrl: OPEN_PAYMENTS_URL,
      assetCode,
      pathName: 'op-client',
      publicName: 'Test client (OP, Node A)'
    });

    // Set once for the whole run: tests run concurrently, so they must not
    // swap globalThis.fetch themselves.
    globalThis.fetch = fetchWithoutContentLength(nativeFetch);
    logger.info('Setup complete');
  });

  after(async () => {
    globalThis.fetch = nativeFetch;
    if (composeLogsPath) {
      logger.info(`writing Compose logs to ${composeLogsPath}`);
    }
    dumpComposeLogs();
    if (keepStack) {
      console.log(
        'Leaving Compose containers, network, and volumes in place (--keep)'
      );
      return;
    }
    await environment?.down();
  });

  describe('Admin API', () => {
    test('local payment', async (t) => {
      const progress = { failed: false };
      let senderAddress: string;
      let receiverAddress: string;
      let paymentIntentId: string;
      let quoteId: string;
      let paymentId: string;

      await step(t, progress, 'create sender wallet address', async () => {
        const sender = await createWalletAddress(
          adminClient,
          assetCode,
          'sender',
          'test sender'
        );
        senderAddress = sender.address;
      });

      await step(t, progress, 'create receiver wallet address', async () => {
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
        const paymentFound = await poll({
          request: () =>
            adminClient.payments.getPayment(paymentIntentId, paymentId),
          stopWhen: (payment) => payment.state === 'COMPLETED',
          pollingFrequencyMs: 100,
          timeoutMs: 5_000
        });
        assert.equal(paymentFound.id, paymentId);
        assert.equal(paymentFound.state, 'COMPLETED');
      });
    });

    test('local cross-currency payment', async (t) => {
      const incomingAmount = 1000;
      const progress = { failed: false };
      let senderAddress: string;
      let receiverAddress: string;
      let paymentIntentId: string;
      let quoteId: string;
      let debitAmount: string;
      let paymentId: string;

      await step(t, progress, 'create EUR sender wallet', async () => {
        const sender = await createWalletAddress(
          adminClient,
          'EUR',
          'fx-sender',
          'FX sender (Node A)'
        );
        senderAddress = sender.address;
      });

      await step(t, progress, 'create USD receiver wallet', async () => {
        const receiver = await createWalletAddress(
          adminClient,
          'USD',
          'fx-receiver',
          'FX receiver (Node A)'
        );
        receiverAddress = receiver.address;
      });

      await step(t, progress, 'create USD payment intent', async () => {
        const paymentIntent =
          await adminClient.paymentIntents.createPaymentIntent({
            walletAddress: receiverAddress,
            incomingAmount
          });
        assert.ok(paymentIntent.id);
        paymentIntentId = paymentIntent.id;
      });

      await step(t, progress, 'create EUR quote', async () => {
        const quote = await adminClient.quotes.createQuote({
          paymentIntentId,
          walletAddress: senderAddress
        });
        assert.ok(quote.id);
        assert.equal(quote.receiveAmount, String(incomingAmount));
        assert.ok(quote.debitAmount);
        assert.equal(quote.debitAmount, '878');
        quoteId = quote.id;
        debitAmount = quote.debitAmount;
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
        const payment = await poll({
          request: () =>
            adminClient.payments.getPayment(paymentIntentId, paymentId),
          stopWhen: (payment) => payment.state === 'COMPLETED',
          pollingFrequencyMs: 100,
          timeoutMs: 5_000
        });
        assert.deepEqual(payment.debitAmount, {
          value: debitAmount,
          assetCode: 'EUR',
          assetScale: 2
        });
        assert.deepEqual(payment.receiveAmount, {
          value: String(incomingAmount),
          assetCode: 'USD',
          assetScale: 2
        });
      });

      await step(t, progress, 'USD payment intent completes', async () => {
        const paymentIntent = await poll({
          request: () =>
            adminClient.paymentIntents.getPaymentIntent(paymentIntentId),
          stopWhen: (paymentIntent) => paymentIntent.state === 'COMPLETED',
          pollingFrequencyMs: 100,
          timeoutMs: 5_000
        });
        assert.deepEqual(paymentIntent.receivedAmount, {
          value: String(incomingAmount),
          assetCode: 'USD',
          assetScale: 2
        });
      });
    });

    test('remote payment', async (t) => {
      const incomingAmount = 1000;
      const progress = { failed: false };
      let senderAddress: string;
      let receiverAddress: string;
      let paymentIntentUrl: string;
      let quoteId: string;
      let quotePaymentIntentId: string;
      let paymentId: string;

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
        const paymentFound = await poll({
          request: () =>
            adminClient.payments.getPayment(quotePaymentIntentId, paymentId),
          stopWhen: (payment) => payment.state === 'COMPLETED',
          pollingFrequencyMs: 2_000,
          timeoutMs: 5_000
        });
        assert.equal(paymentFound.id, paymentId);
        assert.equal(paymentFound.state, 'COMPLETED');
      });
    });
  });

  describe('Open Payments', { concurrency: true }, () => {
    test('remote payment', async (t) => {
      const progress = { failed: false };
      let senderWalletAddress: WalletAddress;
      let receiverWalletAddress: WalletAddress;
      let incomingPaymentToken: string;
      let incomingPayment: IncomingPayment;
      let quoteToken: string;
      let quote: Quote;
      let pendingGrant: PendingGrant;
      let clientFinishNonce: string;
      let outgoingPayment: OutgoingPayment;

      await step(t, progress, 'set up node A sender wallet', async () => {
        senderWalletAddress = await createOpWalletAddress({
          admin: adminClient,
          openPaymentsUrl: OPEN_PAYMENTS_URL,
          assetCode,
          pathName: 'op-sender',
          publicName: 'Sender (OP, Node A)'
        });
        assert.equal(senderWalletAddress.authServer, OPEN_PAYMENTS_AUTH_URL);
      });

      await step(t, progress, 'create node B receiver wallet', async () => {
        receiverWalletAddress = await createOpWalletAddress({
          admin: adminClientB,
          openPaymentsUrl: NODE_B_OPEN_PAYMENTS_URL,
          assetCode,
          pathName: 'op-receiver',
          publicName: 'Receiver (OP, Node B)'
        });
        assert.equal(
          receiverWalletAddress.authServer,
          NODE_B_OPEN_PAYMENTS_AUTH_URL
        );
      });

      await step(
        t,
        progress,
        'request node B incoming payment grant',
        async () => {
          incomingPaymentToken = await requestIncomingPaymentToken(
            openPaymentsClient,
            receiverWalletAddress.authServer
          );
        }
      );

      await step(t, progress, 'create node B incoming payment', async () => {
        incomingPayment = await openPaymentsClient.incomingPayment.create(
          {
            url: NODE_B_OPEN_PAYMENTS_URL,
            accessToken: incomingPaymentToken
          },
          {
            walletAddress: receiverWalletAddress.id,
            incomingAmount: {
              assetCode,
              assetScale: 2,
              value: '1000'
            }
          }
        );
        assert.ok(incomingPayment.id);
      });

      await step(t, progress, 'request node A quote grant', async () => {
        const grant = await openPaymentsClient.grant.request(
          { url: senderWalletAddress.authServer },
          {
            access_token: {
              access: [{ type: 'quote', actions: ['create', 'read'] }]
            }
          }
        );
        assert.ok(isFinalizedGrantWithAccessToken(grant));
        quoteToken = grant.access_token.value;
      });

      await step(t, progress, 'create node A quote', async () => {
        quote = await openPaymentsClient.quote.create(
          { url: OPEN_PAYMENTS_URL, accessToken: quoteToken },
          {
            walletAddress: senderWalletAddress.id,
            receiver: incomingPayment.id,
            method: 'ilp'
          }
        );
        assert.ok(quote.id);
      });

      await step(
        t,
        progress,
        'request node A outgoing payment grant',
        async () => {
          clientFinishNonce = randomUUID();
          const grant = await openPaymentsClient.grant.request(
            { url: senderWalletAddress.authServer },
            {
              access_token: {
                access: [
                  {
                    type: 'outgoing-payment',
                    actions: ['create', 'read'],
                    identifier: senderWalletAddress.id,
                    limits: { debitAmount: quote.debitAmount }
                  }
                ]
              },
              interact: {
                start: ['redirect'],
                finish: {
                  method: 'redirect',
                  uri: CLIENT_FINISH_URI,
                  nonce: clientFinishNonce
                }
              }
            }
          );
          assert.ok(isPendingGrant(grant));
          pendingGrant = grant;
        }
      );

      const accessToken = await approveInteractiveGrant(
        t,
        progress,
        openPaymentsClient,
        pendingGrant!,
        senderWalletAddress!.authServer,
        clientFinishNonce!
      );
      const outgoingPaymentToken = accessToken.value;

      await step(t, progress, 'create node A outgoing payment', async () => {
        outgoingPayment = await openPaymentsClient.outgoingPayment.create(
          { url: OPEN_PAYMENTS_URL, accessToken: outgoingPaymentToken },
          { walletAddress: senderWalletAddress.id, quoteId: quote.id }
        );
        assert.ok(outgoingPayment.id);
        assert.deepEqual(outgoingPayment.debitAmount, quote.debitAmount);
      });

      await step(t, progress, 'outgoing payment completes', async () => {
        const sent = await poll({
          request: () =>
            openPaymentsClient.outgoingPayment.get({
              url: toHostUrl(outgoingPayment.id, OPEN_PAYMENTS_URL),
              accessToken: outgoingPaymentToken
            }),
          stopWhen: (payment) =>
            payment.failed ||
            payment.sentAmount.value === payment.debitAmount.value,
          pollingFrequencyMs: 100,
          timeoutMs: 5_000
        });
        assert.equal(sent.failed, false);
        assert.deepEqual(sent.sentAmount, sent.debitAmount);
      });

      await step(t, progress, 'node B incoming payment completes', async () => {
        const completed = await poll({
          request: () =>
            openPaymentsClient.incomingPayment.get({
              url: toHostUrl(incomingPayment.id, NODE_B_OPEN_PAYMENTS_URL),
              accessToken: incomingPaymentToken
            }),
          stopWhen: (payment) => payment.completed,
          pollingFrequencyMs: 100,
          timeoutMs: 5_000
        });
        assert.deepEqual(completed.receivedAmount, completed.incomingAmount);
      });

      await step(t, progress, 'grant spent amounts', async () => {
        const spent =
          await openPaymentsClient.outgoingPayment.getGrantSpentAmounts({
            url: OPEN_PAYMENTS_URL,
            accessToken: outgoingPaymentToken
          });
        assert.deepEqual(spent.spentDebitAmount, quote.debitAmount);
        assert.equal(spent.spentReceiveAmount, null);
      });
    });

    test('local cross-currency payment', async (t) => {
      const incomingAmount = {
        assetCode: 'USD',
        assetScale: 2,
        value: '1000'
      };
      const progress = { failed: false };
      let senderWalletAddress: WalletAddress;
      let receiverWalletAddress: WalletAddress;
      let incomingPaymentToken: string;
      let incomingPayment: IncomingPayment;
      let quote: Quote;
      let pendingGrant: PendingGrant;
      let clientFinishNonce: string;
      let outgoingPayment: OutgoingPayment;

      await step(t, progress, 'set up EUR sender wallet', async () => {
        senderWalletAddress = await createOpWalletAddress({
          admin: adminClient,
          openPaymentsUrl: OPEN_PAYMENTS_URL,
          assetCode: 'EUR',
          pathName: 'op-fx-sender',
          publicName: 'FX sender (OP, Node A)'
        });
        assert.equal(senderWalletAddress.assetCode, 'EUR');
      });

      await step(t, progress, 'create USD receiver wallet', async () => {
        receiverWalletAddress = await createOpWalletAddress({
          admin: adminClient,
          openPaymentsUrl: OPEN_PAYMENTS_URL,
          assetCode: 'USD',
          pathName: 'op-fx-receiver',
          publicName: 'FX receiver (OP, Node A)'
        });
        assert.equal(receiverWalletAddress.assetCode, 'USD');
      });

      await step(t, progress, 'create USD incoming payment', async () => {
        incomingPaymentToken = await requestIncomingPaymentToken(
          openPaymentsClient,
          receiverWalletAddress.authServer
        );

        incomingPayment = await openPaymentsClient.incomingPayment.create(
          { url: OPEN_PAYMENTS_URL, accessToken: incomingPaymentToken },
          { walletAddress: receiverWalletAddress.id, incomingAmount }
        );
        assert.ok(incomingPayment.id);
      });

      await step(t, progress, 'create EUR quote', async () => {
        const grant = await openPaymentsClient.grant.request(
          { url: senderWalletAddress.authServer },
          {
            access_token: {
              access: [{ type: 'quote', actions: ['create', 'read'] }]
            }
          }
        );
        assert.ok(isFinalizedGrantWithAccessToken(grant));

        quote = await openPaymentsClient.quote.create(
          { url: OPEN_PAYMENTS_URL, accessToken: grant.access_token.value },
          {
            walletAddress: senderWalletAddress.id,
            receiver: incomingPayment.id,
            method: 'ilp'
          }
        );
        assert.equal(quote.receiver, incomingPayment.id);
        assert.deepEqual(quote.receiveAmount, incomingAmount);
        assert.equal(quote.debitAmount.assetCode, 'EUR');
        assert.equal(quote.debitAmount.assetScale, 2);
        // 10.00 USD at EUR -> USD 1.14 is 8.7719... EUR, rounded up so the
        // receiver is never short-paid.
        assert.equal(quote.debitAmount.value, '878');
      });

      await step(t, progress, 'request outgoing payment grant', async () => {
        clientFinishNonce = randomUUID();
        const grant = await openPaymentsClient.grant.request(
          { url: senderWalletAddress.authServer },
          {
            access_token: {
              access: [
                {
                  type: 'outgoing-payment',
                  actions: ['create', 'read'],
                  identifier: senderWalletAddress.id,
                  limits: { debitAmount: quote.debitAmount }
                }
              ]
            },
            interact: {
              start: ['redirect'],
              finish: {
                method: 'redirect',
                uri: CLIENT_FINISH_URI,
                nonce: clientFinishNonce
              }
            }
          }
        );
        assert.ok(isPendingGrant(grant));
        pendingGrant = grant;
      });

      const outgoingPaymentGrant = await approveInteractiveGrant(
        t,
        progress,
        openPaymentsClient,
        pendingGrant!,
        senderWalletAddress!.authServer,
        clientFinishNonce!
      );
      const outgoingPaymentToken = outgoingPaymentGrant.value;

      await step(t, progress, 'create EUR outgoing payment', async () => {
        outgoingPayment = await openPaymentsClient.outgoingPayment.create(
          { url: OPEN_PAYMENTS_URL, accessToken: outgoingPaymentToken },
          { walletAddress: senderWalletAddress.id, quoteId: quote.id }
        );
        assert.deepEqual(outgoingPayment.debitAmount, quote.debitAmount);
        assert.deepEqual(outgoingPayment.receiveAmount, quote.receiveAmount);
      });

      await step(t, progress, 'outgoing payment completes', async () => {
        const sent = await poll({
          request: () =>
            openPaymentsClient.outgoingPayment.get({
              url: toHostUrl(outgoingPayment.id, OPEN_PAYMENTS_URL),
              accessToken: outgoingPaymentToken
            }),
          stopWhen: (payment) =>
            payment.failed ||
            payment.sentAmount.value === payment.debitAmount.value,
          pollingFrequencyMs: 100,
          timeoutMs: 5_000
        });
        assert.equal(sent.failed, false);
        assert.deepEqual(sent.sentAmount, quote.debitAmount);
      });

      await step(t, progress, 'USD incoming payment completes', async () => {
        const completed = await poll({
          request: () =>
            openPaymentsClient.incomingPayment.get({
              url: toHostUrl(incomingPayment.id, OPEN_PAYMENTS_URL),
              accessToken: incomingPaymentToken
            }),
          stopWhen: (payment) => payment.completed,
          pollingFrequencyMs: 100,
          timeoutMs: 5_000
        });
        assert.deepEqual(completed.receivedAmount, incomingAmount);
      });
    });

    // Sends more outgoing payments at once than the grant's debitAmount
    // limit allows. Exactly the payments that fit the limit may be created:
    // the rest must be refused, not double spent.
    test('concurrent payments within one limit', async (t) => {
      const paymentCount = 4;
      const paymentsWithinLimit = 2;
      const debitAmount = { assetCode, assetScale: 2, value: '1000' };
      const debitAmountLimit = {
        ...debitAmount,
        value: String(BigInt(debitAmount.value) * BigInt(paymentsWithinLimit))
      };
      const progress = { failed: false };
      let senderWalletAddress: WalletAddress;
      let receiverWalletAddress: WalletAddress;
      let incomingPaymentToken: string;
      const incomingPayments: IncomingPayment[] = [];
      let pendingGrant: PendingGrant;
      let clientFinishNonce: string;
      let outgoingPaymentResults: PromiseSettledResult<OutgoingPayment>[];

      await step(t, progress, 'set up node A sender wallet', async () => {
        senderWalletAddress = await createOpWalletAddress({
          admin: adminClient,
          openPaymentsUrl: OPEN_PAYMENTS_URL,
          assetCode,
          pathName: 'op-limit-sender',
          publicName: 'Limit sender (OP, Node A)'
        });
      });

      await step(t, progress, 'create node B receiver wallet', async () => {
        receiverWalletAddress = await createOpWalletAddress({
          admin: adminClientB,
          openPaymentsUrl: NODE_B_OPEN_PAYMENTS_URL,
          assetCode,
          pathName: 'op-limit-receiver',
          publicName: 'Limit receiver (OP, Node B)'
        });
      });

      await step(
        t,
        progress,
        'request node B incoming payment grant',
        async () => {
          incomingPaymentToken = await requestIncomingPaymentToken(
            openPaymentsClient,
            receiverWalletAddress.authServer
          );
        }
      );

      await step(t, progress, 'create node B incoming payments', async () => {
        for (let i = 0; i < paymentCount; i++) {
          const incomingPayment =
            await openPaymentsClient.incomingPayment.create(
              {
                url: NODE_B_OPEN_PAYMENTS_URL,
                accessToken: incomingPaymentToken
              },
              {
                walletAddress: receiverWalletAddress.id,
                incomingAmount: { assetCode, assetScale: 2, value: '1000' }
              }
            );
          assert.ok(incomingPayment.id);
          incomingPayments.push(incomingPayment);
        }
      });

      await step(
        t,
        progress,
        'request node A outgoing payment grant',
        async () => {
          clientFinishNonce = randomUUID();
          const grant = await openPaymentsClient.grant.request(
            { url: senderWalletAddress.authServer },
            {
              access_token: {
                access: [
                  {
                    type: 'outgoing-payment',
                    actions: ['create', 'read'],
                    identifier: senderWalletAddress.id,
                    limits: { debitAmount: debitAmountLimit }
                  }
                ]
              },
              interact: {
                start: ['redirect'],
                finish: {
                  method: 'redirect',
                  uri: CLIENT_FINISH_URI,
                  nonce: clientFinishNonce
                }
              }
            }
          );
          assert.ok(isPendingGrant(grant));
          pendingGrant = grant;
        }
      );

      const outgoingPaymentGrant = await approveInteractiveGrant(
        t,
        progress,
        openPaymentsClient,
        pendingGrant!,
        senderWalletAddress!.authServer,
        clientFinishNonce!
      );
      const outgoingPaymentToken = outgoingPaymentGrant.value;

      await step(
        t,
        progress,
        'create node A outgoing payments concurrently',
        async () => {
          outgoingPaymentResults = await Promise.allSettled(
            incomingPayments.map((incomingPayment) =>
              openPaymentsClient.outgoingPayment.create(
                {
                  url: OPEN_PAYMENTS_URL,
                  accessToken: outgoingPaymentToken
                },
                {
                  walletAddress: senderWalletAddress.id,
                  incomingPayment: incomingPayment.id,
                  debitAmount
                }
              )
            )
          );

          const fulfilled = outgoingPaymentResults.filter(
            (result) => result.status === 'fulfilled'
          );
          const rejected = outgoingPaymentResults.filter(
            (result) => result.status === 'rejected'
          );
          assert.equal(fulfilled.length, paymentsWithinLimit);
          assert.equal(rejected.length, paymentCount - paymentsWithinLimit);
          for (const { reason } of rejected) {
            assert.ok(
              reason instanceof OpenPaymentsClientError,
              `unexpected rejection: ${reason}`
            );
            assert.equal(reason.status, 403);
            assert.equal(reason.code, 'insufficient_grant');
          }
        }
      );

      await step(t, progress, 'grant spent amounts', async () => {
        const spent =
          await openPaymentsClient.outgoingPayment.getGrantSpentAmounts({
            url: OPEN_PAYMENTS_URL,
            accessToken: outgoingPaymentToken
          });
        assert.deepEqual(spent.spentDebitAmount, debitAmountLimit);
      });

      await step(
        t,
        progress,
        'created outgoing payments complete',
        async () => {
          for (const result of outgoingPaymentResults) {
            if (result.status !== 'fulfilled') continue;
            const sent = await poll({
              request: () =>
                openPaymentsClient.outgoingPayment.get({
                  url: toHostUrl(result.value.id, OPEN_PAYMENTS_URL),
                  accessToken: outgoingPaymentToken
                }),
              stopWhen: (payment) =>
                payment.failed ||
                payment.sentAmount.value === payment.debitAmount.value,
              pollingFrequencyMs: 100,
              timeoutMs: 5_000
            });
            assert.equal(sent.failed, false);
            assert.deepEqual(sent.sentAmount, sent.debitAmount);
          }
        }
      );

      await step(
        t,
        progress,
        'only paid node B incoming payments receive funds',
        async () => {
          for (const [index, result] of outgoingPaymentResults.entries()) {
            const url = toHostUrl(
              incomingPayments[index].id,
              NODE_B_OPEN_PAYMENTS_URL
            );

            if (result.status === 'fulfilled') {
              const { receiveAmount } = result.value;
              const received = await poll({
                request: () =>
                  openPaymentsClient.incomingPayment.get({
                    url,
                    accessToken: incomingPaymentToken
                  }),
                stopWhen: (payment) =>
                  payment.receivedAmount.value === receiveAmount.value,
                pollingFrequencyMs: 100,
                timeoutMs: 5_000
              });
              assert.deepEqual(received.receivedAmount, receiveAmount);
            } else {
              const unpaid = await openPaymentsClient.incomingPayment.get({
                url,
                accessToken: incomingPaymentToken
              });
              assert.equal(unpaid.completed, false);
              assert.equal(unpaid.receivedAmount.value, '0');
            }
          }
        }
      );
    });

    test('multiple outgoing payments for grant', async (t) => {
      const incomingAmount = { assetCode, assetScale: 2, value: '1000' };
      const debitAmountLimit = { assetCode, assetScale: 2, value: '2500' };
      const progress = { failed: false };
      let senderWalletAddress: WalletAddress;
      let shopWalletAddress: WalletAddress;
      let incomingPaymentToken: string;
      let pendingGrant: PendingGrant;
      let clientFinishNonce: string;
      let accessToken: { value: string; manage: string };
      const payments: OutgoingPayment[] = [];
      const rotatedOutTokens: string[] = [];

      // Rotates the token before every payment.
      const rotate = async () => {
        const rotated = await openPaymentsClient.token.rotate({
          url: accessToken.manage,
          accessToken: accessToken.value
        });
        assert.notEqual(rotated.access_token.value, accessToken.value);
        rotatedOutTokens.push(accessToken.value);
        accessToken = rotated.access_token;
      };

      const createIncomingPayment = () =>
        openPaymentsClient.incomingPayment.create(
          {
            url: NODE_B_OPEN_PAYMENTS_URL,
            accessToken: incomingPaymentToken
          },
          {
            walletAddress: shopWalletAddress.id,
            incomingAmount: incomingAmount,
            metadata: { description: 'Purchase at Test Boutique' }
          }
        );

      const pay = async () => {
        const incomingPayment = await createIncomingPayment();
        await rotate();
        return openPaymentsClient.outgoingPayment.create(
          { url: OPEN_PAYMENTS_URL, accessToken: accessToken.value },
          {
            walletAddress: senderWalletAddress.id,
            incomingPayment: incomingPayment.id,
            debitAmount: incomingAmount,
            metadata: { type: 'instant' }
          }
        );
      };

      await step(t, progress, 'set up node A customer wallet', async () => {
        senderWalletAddress = await createOpWalletAddress({
          admin: adminClient,
          openPaymentsUrl: OPEN_PAYMENTS_URL,
          assetCode,
          pathName: 'op-multi-payment-sender',
          publicName: 'Multi-payment sender (OP, Node A)'
        });
      });

      await step(t, progress, 'create node B shop wallet', async () => {
        shopWalletAddress = await createOpWalletAddress({
          admin: adminClientB,
          openPaymentsUrl: NODE_B_OPEN_PAYMENTS_URL,
          assetCode,
          pathName: 'op-multi-payment-receiver',
          publicName: 'Multi-payment receiver (OP, Node B)'
        });
      });

      await step(
        t,
        progress,
        'request node B incoming payment grant',
        async () => {
          incomingPaymentToken = await requestIncomingPaymentToken(
            openPaymentsClient,
            shopWalletAddress.authServer
          );
        }
      );

      await step(t, progress, 'request outgoing payment grant', async () => {
        clientFinishNonce = randomUUID();
        const grant = await openPaymentsClient.grant.request(
          { url: senderWalletAddress.authServer },
          {
            access_token: {
              access: [
                {
                  type: 'outgoing-payment',
                  actions: ['create', 'read', 'list'],
                  identifier: senderWalletAddress.id,
                  limits: { debitAmount: debitAmountLimit }
                }
              ]
            },
            interact: {
              start: ['redirect'],
              finish: {
                method: 'redirect',
                // A finish url with its own query string, like the
                // boutique's.
                uri: `${CLIENT_FINISH_URI}?identifier=${randomUUID()}`,
                nonce: clientFinishNonce
              }
            }
          }
        );
        assert.ok(isPendingGrant(grant));
        pendingGrant = grant;
      });

      accessToken = await approveInteractiveGrant(
        t,
        progress,
        openPaymentsClient,
        pendingGrant!,
        senderWalletAddress!.authServer,
        clientFinishNonce!
      );

      await step(t, progress, 'first outgoing payment', async () => {
        payments.push(await pay());
      });

      await step(t, progress, 'rotated-out token is rejected', async () => {
        await assert.rejects(
          openPaymentsClient.outgoingPayment.getGrantSpentAmounts({
            url: OPEN_PAYMENTS_URL,
            accessToken: rotatedOutTokens.at(-1)!
          }),
          (err) => {
            assert.ok(err instanceof OpenPaymentsClientError);
            assert.equal(err.status, 403);
            assert.equal(err.code, 'inactive_token');
            return true;
          }
        );
      });

      await step(t, progress, 'second outgoing payment', async () => {
        payments.push(await pay());
      });

      await step(t, progress, 'grant spent amounts', async () => {
        const spent =
          await openPaymentsClient.outgoingPayment.getGrantSpentAmounts({
            url: OPEN_PAYMENTS_URL,
            accessToken: accessToken.value
          });
        assert.deepEqual(spent.spentDebitAmount, {
          ...incomingAmount,
          value: String(BigInt(incomingAmount.value) * 2n)
        });
      });

      await step(t, progress, 'outgoing payment over the limit', async () => {
        // 2 x 10.00 spent of 25.00: another 10.00 does not fit.
        await assert.rejects(pay(), (err) => {
          assert.ok(err instanceof OpenPaymentsClientError);
          assert.equal(err.status, 403);
          assert.equal(err.code, 'insufficient_grant');
          return true;
        });
      });

      await step(t, progress, 'outgoing payments complete', async () => {
        for (const payment of payments) {
          const sent = await poll({
            request: () =>
              openPaymentsClient.outgoingPayment.get({
                url: toHostUrl(payment.id, OPEN_PAYMENTS_URL),
                accessToken: accessToken.value
              }),
            stopWhen: (payment) =>
              payment.failed ||
              payment.sentAmount.value === payment.debitAmount.value,
            pollingFrequencyMs: 100,
            timeoutMs: 5_000
          });
          assert.equal(sent.failed, false);
          assert.deepEqual(sent.sentAmount, incomingAmount);
          assert.deepEqual(sent.metadata, { type: 'instant' });
        }
      });
    });

    test('payment refused after grant revoked', async (t) => {
      const debitAmount = { assetCode, assetScale: 2, value: '1000' };
      const debitAmountLimit = { assetCode, assetScale: 2, value: '2000' };
      const progress = { failed: false };
      let senderWalletAddress: WalletAddress;
      let receiverWalletAddress: WalletAddress;
      let incomingPaymentToken: string;
      let pendingGrant: PendingGrant;
      let clientFinishNonce: string;
      let grantId: string;
      let unpaidIncomingPayment: IncomingPayment;

      const createIncomingPayment = () =>
        openPaymentsClient.incomingPayment.create(
          {
            url: NODE_B_OPEN_PAYMENTS_URL,
            accessToken: incomingPaymentToken
          },
          {
            walletAddress: receiverWalletAddress.id,
            incomingAmount: debitAmount
          }
        );

      await step(t, progress, 'set up node A sender wallet', async () => {
        senderWalletAddress = await createOpWalletAddress({
          admin: adminClient,
          openPaymentsUrl: OPEN_PAYMENTS_URL,
          assetCode,
          pathName: 'op-revoke-sender',
          publicName: 'Revoke sender (OP, Node A)'
        });
      });

      await step(t, progress, 'create node B receiver wallet', async () => {
        receiverWalletAddress = await createOpWalletAddress({
          admin: adminClientB,
          openPaymentsUrl: NODE_B_OPEN_PAYMENTS_URL,
          assetCode,
          pathName: 'op-revoke-receiver',
          publicName: 'Revoke receiver (OP, Node B)'
        });
      });

      await step(
        t,
        progress,
        'request node B incoming payment grant',
        async () => {
          incomingPaymentToken = await requestIncomingPaymentToken(
            openPaymentsClient,
            receiverWalletAddress.authServer
          );
        }
      );

      await step(t, progress, 'request outgoing payment grant', async () => {
        clientFinishNonce = randomUUID();
        const grant = await openPaymentsClient.grant.request(
          { url: senderWalletAddress.authServer },
          {
            access_token: {
              access: [
                {
                  type: 'outgoing-payment',
                  actions: ['create', 'read'],
                  identifier: senderWalletAddress.id,
                  limits: { debitAmount: debitAmountLimit }
                }
              ]
            },
            interact: {
              start: ['redirect'],
              finish: {
                method: 'redirect',
                uri: CLIENT_FINISH_URI,
                nonce: clientFinishNonce
              }
            }
          }
        );
        assert.ok(isPendingGrant(grant));
        pendingGrant = grant;
      });

      const outgoingPaymentGrant = await approveInteractiveGrant(
        t,
        progress,
        openPaymentsClient,
        pendingGrant!,
        senderWalletAddress!.authServer,
        clientFinishNonce!
      );
      const outgoingPaymentToken = outgoingPaymentGrant.value;

      const pay = (incomingPayment: IncomingPayment) =>
        openPaymentsClient.outgoingPayment.create(
          { url: OPEN_PAYMENTS_URL, accessToken: outgoingPaymentToken },
          {
            walletAddress: senderWalletAddress.id,
            incomingPayment: incomingPayment.id,
            debitAmount
          }
        );

      await step(t, progress, 'payment before revocation', async () => {
        const payment = await pay(await createIncomingPayment());
        const sent = await poll({
          request: () =>
            openPaymentsClient.outgoingPayment.get({
              url: toHostUrl(payment.id, OPEN_PAYMENTS_URL),
              accessToken: outgoingPaymentToken
            }),
          stopWhen: (payment) =>
            payment.failed ||
            payment.sentAmount.value === payment.debitAmount.value,
          pollingFrequencyMs: 100,
          timeoutMs: 5_000
        });
        assert.equal(sent.failed, false);
        assert.deepEqual(sent.sentAmount, debitAmount);
      });

      await step(t, progress, 'find grant through admin API', async () => {
        // How an ASE operator finds a client's grants for a wallet address.
        const { result } = await adminClient.grants.grantsListGrants([
          senderWalletAddress.id
        ]);
        const outgoingPaymentGrants = result.filter((grant) =>
          grant.accesses?.some(
            (access) =>
              /outgoing.?payment/i.test(access.type) &&
              access.identifier === senderWalletAddress.id
          )
        );
        assert.equal(outgoingPaymentGrants.length, 1);
        grantId = outgoingPaymentGrants[0].id;
      });

      await step(t, progress, 'revoke grant through admin API', async () => {
        const revoked = await adminClient.grants.revokeGrant(grantId);
        assert.equal(revoked.id, grantId);
        const grant = await poll({
          request: () => adminClient.grants.getGrant(grantId),
          stopWhen: (grant) => grant.state === 'REVOKED',
          pollingFrequencyMs: 100,
          timeoutMs: 5_000
        });
        assert.equal(grant.state, 'REVOKED');
      });

      await step(t, progress, 'payment after revocation', async () => {
        unpaidIncomingPayment = await createIncomingPayment();
        // The grant has 10.00 of its 20.00 limit left: only the
        // revocation refuses this payment.
        await assert.rejects(pay(unpaidIncomingPayment), (err) => {
          assert.ok(err instanceof OpenPaymentsClientError);
          assert.equal(err.status, 403);
          assert.equal(err.code, 'inactive_token');
          return true;
        });
      });

      await step(
        t,
        progress,
        'node B incoming payment receives nothing',
        async () => {
          const incomingPayment = await openPaymentsClient.incomingPayment.get({
            url: toHostUrl(unpaidIncomingPayment.id, NODE_B_OPEN_PAYMENTS_URL),
            accessToken: incomingPaymentToken
          });
          assert.equal(incomingPayment.completed, false);
          assert.equal(incomingPayment.receivedAmount.value, '0');
        }
      );
    });
  });
});

// One-time setup on both nodes, shared by every test.
async function setUpNodes(
  nodeA: AdminApiClient,
  nodeB: AdminApiClient
): Promise<void> {
  const assetCode = 'USD';

  logger.info(`Creating assets ${assetCode} and EUR on node A`);
  await createAsset(nodeA, assetCode);
  await createAsset(nodeA, 'EUR');

  logger.info(`Creating asset ${assetCode} on node B`);
  await createAsset(nodeB, assetCode);

  logger.info('Setting EUR -> USD FX rate on node A');
  await nodeA.rates.setFxRate({
    sourceAssetCode: 'EUR',
    destinationAssetCode: 'USD',
    rate: 1.14,
    peerId: null,
    rateTtlSecs: 3600
  });

  logger.info('Creating peer Node B on node A');
  await createPeer(nodeA, {
    id: NODE_B_PEER_ID,
    name: 'Node B',
    assetCode,
    assetScale: 2,
    ilpStaticAddress: 'private.rhyza.b',
    http: {
      outgoing: {
        endpoint: 'http://ilp-connector-service-b:4000/ilp',
        callbackEndpoint: 'http://ilp-connector-service-b:4000/ilp/callback',
        authToken: 'local-peer-token'
      },
      incoming: { authToken: 'local-peer-token' }
    }
  });

  logger.info('Creating peer Node A on node B');
  await createPeer(nodeB, {
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

  logger.info('Depositing liquidity on node A');
  const deposit = await nodeA.liquidity.liquidityDeposit({
    assetCode,
    peerId: NODE_B_PEER_ID,
    amount: 100000,
    amountScale: 2
  });
  assert.ok(deposit.id);
  logger.info('Nodes are set up');
}

async function createWalletAddress(
  client: AdminApiClient,
  assetCode: string,
  pathName: string,
  publicName: string
) {
  const walletAddress = await client.walletAddresses.createWalletAddress({
    assetCode,
    pathName,
    publicName
  });
  assert.ok(walletAddress.id);
  assert.ok(walletAddress.address.endsWith(`/${pathName}`));
  return walletAddress;
}

async function createAsset(client: AdminApiClient, code: string) {
  // The create call stays open until asset activation finishes.
  // Sometimes PAL does not return a response after the asset is created.
  void client.assets.createAsset({ code, scale: 2 }).catch(() => {});

  const { assets } = await poll({
    request: () => client.assets.getAssets(),
    stopWhen: ({ assets }) => assets.some((item) => item.code === code),
    pollingFrequencyMs: 100,
    timeoutMs: 5_000
  });
  const asset = assets.find((item) => item.code === code);
  assert.ok(asset);
  assert.equal(asset.code, code);
  assert.equal(asset.scale, 2);
}

async function createPeer(client: AdminApiClient, peer: PeerCreate) {
  const created = await client.peers.createPeer(peer);
  assert.equal(created.id, peer.id);
}

interface OpWalletAddressOpts {
  admin: AdminApiClient;
  openPaymentsUrl: string;
  assetCode: string;
  pathName: string;
  publicName: string;
}

// Creates a wallet address through the admin API and returns it as its Open
// Payments resource server serves it.
async function createOpWalletAddress(
  opts: OpWalletAddressOpts
): Promise<WalletAddress> {
  await createWalletAddress(
    opts.admin,
    opts.assetCode,
    opts.pathName,
    opts.publicName
  );
  const unauthenticatedClient = await createUnauthenticatedClient({
    useHttp: true
  });
  return unauthenticatedClient.walletAddress.get({
    url: `${opts.openPaymentsUrl}/${opts.pathName}`
  });
}

// Requests a non-interactive incoming payment grant and returns its token.
async function requestIncomingPaymentToken(
  client: AuthenticatedClient,
  authServer: string
): Promise<string> {
  const grant = await client.grant.request(
    { url: authServer },
    {
      access_token: {
        access: [{ type: 'incoming-payment', actions: ['create', 'read'] }]
      }
    }
  );
  assert.ok(isFinalizedGrantWithAccessToken(grant));
  return grant.access_token.value;
}

async function setUpOpClient(
  opts: OpWalletAddressOpts
): Promise<AuthenticatedClient> {
  const created = await createWalletAddress(
    opts.admin,
    opts.assetCode,
    opts.pathName,
    opts.publicName
  );

  const keyId = `${opts.pathName}-key`;
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  assert.ok(x);
  await opts.admin.walletAddresses.createWalletAddressKey(created.id, {
    kid: keyId,
    alg: 'EdDSA',
    kty: 'OKP',
    crv: 'Ed25519',
    x
  });

  const unauthenticatedClient = await createUnauthenticatedClient({
    useHttp: true
  });
  const identityWalletAddress = await unauthenticatedClient.walletAddress.get({
    url: `${opts.openPaymentsUrl}/${opts.pathName}`
  });

  // Identify by the wallet address url, not the localhost URL: each node's
  // auth server fetches the client's jwks.json from it inside Compose.
  return createAuthenticatedClient({
    walletAddressUrl: identityWalletAddress.id,
    privateKey,
    keyId,
    useHttp: true
  });
}

async function poll<T>(args: {
  request: () => Promise<T>;
  stopWhen: (result: T) => boolean;
  pollingFrequencyMs: number;
  timeoutMs: number;
}): Promise<T> {
  const deadline = Date.now() + args.timeoutMs;

  for (;;) {
    await setTimeout(args.pollingFrequencyMs);
    const result = await args.request();
    if (args.stopWhen(result)) return result;
    if (Date.now() >= deadline) {
      throw new Error('Request timed out');
    }
  }
}

// testcontainers loads undici 8, which installs itself as the dispatcher for
// Node's built-in fetch. The SDK sets Content-Length explicitly (it is a signed
// component), fetch appends its own, and undici 8 rejects the combined value
// with "invalid content-length header" ("fetch failed"). Drop the explicit one:
// fetch sets the same value, so the signature still verifies.
// Remove once Node's bundled fetch stops appending the duplicate:
// https://github.com/nodejs/undici/issues/5500
function fetchWithoutContentLength(
  fetchFn: typeof globalThis.fetch
): typeof globalThis.fetch {
  return (input, init) => {
    if (input instanceof Request && input.headers.has('content-length')) {
      const headers = new Headers(input.headers);
      headers.delete('content-length');
      return fetchFn(new Request(input, { headers }), init);
    }
    return fetchFn(input, init);
  };
}

// Resource ids use the resource server's Compose host name, which only
// resolves inside the Compose network.
function toHostUrl(resourceUrl: string, hostBaseUrl: string): string {
  const { pathname } = new URL(resourceUrl);
  return `${hostBaseUrl}${pathname}`;
}

// Stands in for the user's browser and the IDP: starts the interaction,
// accepts it, finishes it, checks the finish hash and continues the grant.
// Drives the interaction a pending grant asks for and returns the finalized
// grant's access token, with its manage url.
async function approveInteractiveGrant(
  t: TestContext,
  progress: { failed: boolean },
  client: AuthenticatedClient,
  pendingGrant: PendingGrant,
  authServer: string,
  clientFinishNonce: string
): Promise<{ value: string; manage: string }> {
  // .../interaction/:grantId/start
  const grantId = new URL(pendingGrant.interact.redirect).pathname
    .split('/')
    .at(-2);

  let sessionCookie: string | undefined;
  await step(t, progress, 'start interaction', async () => {
    // Stands in for the user's browser. The session cookie is Secure, so
    // X-Forwarded-Proto stands in for a TLS-terminating proxy.
    const startResponse = await fetch(pendingGrant.interact.redirect, {
      redirect: 'manual',
      headers: { 'X-Forwarded-Proto': 'https' }
    });
    assert.equal(startResponse.status, 302);
    const cookie = startResponse.headers
      .getSetCookie()
      .find((entry) => entry.startsWith('interactionSessionId='));
    assert.ok(cookie);
    sessionCookie = cookie;
  });

  await step(t, progress, 'accept interaction', async () => {
    // Stands in for the user approving the grant on the IDP consent screen.
    const acceptResponse = await fetch(
      `${IDP_INTERACTION_URL}/interaction/${grantId}/accept`,
      { method: 'POST', headers: { 'x-idp-secret': IDP_SECRET } }
    );
    assert.equal(acceptResponse.status, 202);
  });

  let interactRef: string | undefined;
  await step(t, progress, 'finish interaction', async () => {
    assert.ok(sessionCookie);
    const finishResponse = await fetch(
      `${authServer}/interaction/${grantId}/finish`,
      {
        method: 'POST',
        redirect: 'manual',
        headers: { Cookie: sessionCookie.split(';')[0] }
      }
    );
    assert.equal(finishResponse.status, 302);
    const location = finishResponse.headers.get('location');
    assert.ok(location);
    assert.ok(location.startsWith(CLIENT_FINISH_URI));
    const params = new URL(location).searchParams;
    const ref = params.get('interact_ref');
    assert.ok(ref);
    const expectedHash = createHash('sha256')
      .update(
        [clientFinishNonce, pendingGrant.interact.finish, ref, authServer].join(
          '\n'
        )
      )
      .digest('base64url');
    assert.equal(params.get('hash'), expectedHash);
    interactRef = ref;
  });

  let accessToken: { value: string; manage: string } | undefined;
  await step(t, progress, 'continue grant', async () => {
    assert.ok(interactRef);
    // The auth server rejects a continuation within 5s of the grant request
    // and does not send continue.wait yet.
    await setTimeout(CONTINUE_WAIT_MS);
    const grant = await client.grant.continue(
      {
        url: pendingGrant.continue.uri,
        accessToken: pendingGrant.continue.access_token.value
      },
      { interact_ref: interactRef }
    );
    assert.ok(isFinalizedGrantWithAccessToken(grant));
    accessToken = grant.access_token;
  });

  assert.ok(accessToken, 'grant was not approved');
  return accessToken;
}

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

// Watch for container events and record them.
function startContainerEventWatch(): {
  recorded: () => string;
  stop: () => void;
} {
  const lines: string[] = [];
  const args = [
    'events',
    '--filter',
    'type=container',
    '--filter',
    'event=die',
    '--filter',
    'event=restart',
    '--filter',
    'event=oom',
    '--format',
    '{{.Actor.Attributes.name}} {{.Action}} id={{.Actor.ID}} exit={{.Actor.Attributes.exitCode}}'
  ];
  if (composeProject) {
    args.push('--filter', `label=com.docker.compose.project=${composeProject}`);
  }

  const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const append = (chunk: Buffer) => {
    lines.push(chunk.toString());
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);

  return {
    recorded: () => lines.join('').trim(),
    stop: () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
    }
  };
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
