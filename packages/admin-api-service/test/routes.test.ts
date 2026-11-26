import { test } from 'node:test';
import { AuthClient } from 'auth-client-lib';
import { IlpClient } from 'ilp-client-lib';
import { PalClient } from 'pal-client-lib';
import { PaymentsClient } from 'payments-client-lib';
import { assetRoutes } from '../src/routes/assets.js';
import { grantRoutes } from '../src/routes/grants.js';
import { liquidityRoutes } from '../src/routes/liquidity.js';
import { paymentIntentRoutes } from '../src/routes/payment-intents.js';
import { paymentRoutes } from '../src/routes/payments.js';
import { peerRoutes } from '../src/routes/peers.js';
import { quoteRoutes } from '../src/routes/quotes.js';
import { ratesRoutes } from '../src/routes/rates.js';
import { walletAddressRoutes } from '../src/routes/wallet-addresses.js';
import { createTestApp } from './helpers.js';

test('all route schemas compile with the OpenAPI validator', async () => {
  const app = createTestApp();
  const palClient = {} as PalClient;
  const paymentsClient = {} as PaymentsClient;

  app.register(assetRoutes, { palClient });
  app.register(grantRoutes, { authClient: {} as AuthClient });
  app.register(liquidityRoutes, { palClient });
  app.register(paymentIntentRoutes, {
    palClient,
    paymentsClient,
    openPaymentsUrl: undefined
  });
  app.register(paymentRoutes, { palClient, paymentsClient });
  app.register(peerRoutes, { palClient, ilpClient: {} as IlpClient });
  app.register(quoteRoutes, { palClient, paymentsClient });
  app.register(ratesRoutes, { palClient });
  app.register(walletAddressRoutes, {
    palClient,
    openPaymentsUrl: undefined
  });

  await app.ready();
  await app.close();
});
