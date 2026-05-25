'use strict';

import Fastify, { FastifyInstance } from 'fastify';
import { PalClient } from 'pal-client-lib';
import { PaymentsClient } from 'payments-client-lib';
import { assetRoutes } from './routes/assets.js';
import { walletAddressRoutes } from './routes/wallet-addresses.js';
import { incomingPaymentRoutes } from './routes/incoming-payments.js';
import { quoteRoutes } from './routes/quotes.js';
import { outgoingPaymentRoutes } from './routes/outgoing-payments.js';

const PORT = parseInt(process.env['PORT'] || '3001', 10);
const HOST = process.env['HOST'] || '0.0.0.0';
const PAL_GRPC_URL = process.env['PAL_GRPC_URL'] || 'localhost:50051';
const PAYMENTS_GRPC_URL = process.env['PAYMENTS_GRPC_URL'] || 'localhost:50052';
const OPEN_PAYMENTS_URL = process.env['OPEN_PAYMENTS_URL'];

export class AdminApiService {
  private static server: FastifyInstance;
  private static palClient: PalClient;
  private static paymentsClient: PaymentsClient;

  static async start(): Promise<void> {
    this.palClient = new PalClient(PAL_GRPC_URL);
    await this.palClient.init();
    console.log(`Connected to PAL service at ${PAL_GRPC_URL}`);

    this.paymentsClient = new PaymentsClient(
      PAYMENTS_GRPC_URL,
      5_000,
      OPEN_PAYMENTS_URL
    );
    await this.paymentsClient.init();
    console.log(`Connected to Payments service at ${PAYMENTS_GRPC_URL}`);

    // TODO: Wire up OpenAPI spec for route validation.
    // e.g. fastify-openapi-glue to generate validation from the spec
    this.server = Fastify({ logger: true });

    this.server.register(assetRoutes, {
      palClient: this.palClient
    });
    this.server.register(walletAddressRoutes, {
      palClient: this.palClient
    });
    this.server.register(incomingPaymentRoutes, {
      palClient: this.palClient,
      paymentsClient: this.paymentsClient,
      openPaymentsUrl: OPEN_PAYMENTS_URL
    });
    this.server.register(quoteRoutes, {
      palClient: this.palClient,
      paymentsClient: this.paymentsClient
    });
    this.server.register(outgoingPaymentRoutes, {
      palClient: this.palClient,
      paymentsClient: this.paymentsClient
    });

    await this.server.listen({ port: PORT, host: HOST });
    console.log(`Admin API listening on ${HOST}:${PORT}`);
  }

  static async stop(): Promise<void> {
    await this.server?.close();
    await this.palClient?.disconnect();
    await this.paymentsClient?.disconnect();
  }
}
