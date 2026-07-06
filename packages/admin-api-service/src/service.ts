'use strict';

import Fastify, { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { PalClient } from 'pal-client-lib';
import { PaymentsClient } from 'payments-client-lib';
import { assetRoutes } from './routes/assets.js';
import { walletAddressRoutes } from './routes/wallet-addresses.js';
import { paymentIntentRoutes } from './routes/payment-intents.js';
import { quoteRoutes } from './routes/quotes.js';
import { paymentRoutes } from './routes/payments.js';
import { ILogger } from '../../common-types-lib/src/index.js';
import { PinoLogger } from 'implementations-lib';
import crypto from 'crypto';

const BC_NAME = 'ADMIN';
const APP_NAME = `${BC_NAME}_API_SVC`;
const INSTANCE_ID = `${APP_NAME}_${crypto.randomUUID()}`;

const PORT = parseInt(process.env['PORT'] || '3001', 10);
const HOST = process.env['HOST'] || '0.0.0.0';
const PAL_GRPC_URL = process.env['PAL_GRPC_URL'] || 'localhost:50051';
const PAYMENTS_GRPC_URL = process.env['PAYMENTS_GRPC_URL'] || 'localhost:50052';
const OPEN_PAYMENTS_URL = process.env['OPEN_PAYMENTS_URL'];

export class AdminApiService {
  private static logger: ILogger;
  private static server: FastifyInstance;
  private static palClient: PalClient;
  private static paymentsClient: PaymentsClient;

  static async start(): Promise<void> {
    this.logger = new PinoLogger({
      bcName: BC_NAME,
      appName: APP_NAME,
      instanceId: INSTANCE_ID
    });

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
    this.server = Fastify({
      // If logger is not a PinoLogger, enable Fastify's default logging
      logger: PinoLogger.isPinoLogger(this.logger) ? undefined : true,
      loggerInstance: PinoLogger.isPinoLogger(this.logger)
        ? (this.logger.internalLogger as FastifyBaseLogger)
        : undefined
    });

    this.server.register(assetRoutes, {
      palClient: this.palClient
    });
    this.server.register(walletAddressRoutes, {
      palClient: this.palClient
    });
    this.server.register(paymentIntentRoutes, {
      palClient: this.palClient,
      paymentsClient: this.paymentsClient,
      openPaymentsUrl: OPEN_PAYMENTS_URL
    });
    this.server.register(quoteRoutes, {
      palClient: this.palClient,
      paymentsClient: this.paymentsClient
    });
    this.server.register(paymentRoutes, {
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
