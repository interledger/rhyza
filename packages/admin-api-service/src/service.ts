'use strict';

import Fastify, { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { PalClient } from 'pal-client-lib';
import { PaymentsClient } from 'payments-client-lib';
import { IlpClient } from 'ilp-client-lib';
import { assetRoutes } from './routes/assets.js';
import { walletAddressRoutes } from './routes/wallet-addresses.js';
import { peerRoutes } from './routes/peers.js';
import { paymentIntentRoutes } from './routes/payment-intents.js';
import { quoteRoutes } from './routes/quotes.js';
import { paymentRoutes } from './routes/payments.js';
import { liquidityRoutes } from './routes/liquidity.js';
import { grantRoutes } from './routes/grants.js';
import { ratesRoutes } from './routes/rates.js';
import { ILogger } from '../../common-types-lib/src/index.js';
import {
  PinoLogger,
  KafkaBuilder,
  KafkaProducer,
  MessageSerializationFactory
} from 'implementations-lib';
import crypto from 'crypto';
import { AuthClient } from 'auth-client-lib';

const BC_NAME = 'ADMIN';
const APP_NAME = `${BC_NAME}_API_SVC`;
const INSTANCE_ID = `${APP_NAME}_${crypto.randomUUID()}`;

const PORT = parseInt(process.env['PORT'] || '3001', 10);
const HOST = process.env['HOST'] || '0.0.0.0';
const PAL_GRPC_URL = process.env['PAL_GRPC_URL'] || 'localhost:50051';
const PAYMENTS_GRPC_URL = process.env['PAYMENTS_GRPC_URL'] || 'localhost:50052';
const ILP_GRPC_URL = process.env['ILP_GRPC_URL'] || 'localhost:50053';
const AUTH_GRPC_URL = process.env['AUTH_GRPC_URL'] || 'localhost:50054';
const OPEN_PAYMENTS_URL = process.env['OPEN_PAYMENTS_URL'];
const KAFKA_URL = process.env['KAFKA_URL'] || 'localhost:9092';

export class AdminApiService {
  private static logger: ILogger;
  private static server: FastifyInstance;
  private static palClient: PalClient;
  private static paymentsClient: PaymentsClient;
  private static ilpClient: IlpClient;
  private static authClient: AuthClient;
  private static msgProducer: KafkaProducer;

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

    this.ilpClient = new IlpClient(ILP_GRPC_URL);
    await this.ilpClient.init();
    console.log(`Connected to ILP service at ${ILP_GRPC_URL}`);

    this.authClient = new AuthClient(AUTH_GRPC_URL);
    await this.authClient.init();
    console.log(`Connected to Auth service at ${AUTH_GRPC_URL}`);

    const kafkaBuilder = new KafkaBuilder()
      .withLogger(this.logger.child('kafka'))
      .withBrokerList(KAFKA_URL)
      .withClientId(INSTANCE_ID)
      .withSerializerFactory(MessageSerializationFactory.instance());
    this.msgProducer = kafkaBuilder.buildProducer({});
    await this.msgProducer.connect();
    console.log(`Connected Kafka producer to ${KAFKA_URL}`);

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
    this.server.register(peerRoutes, {
      palClient: this.palClient,
      ilpClient: this.ilpClient
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
    this.server.register(liquidityRoutes, {
      palClient: this.palClient
    });
    this.server.register(grantRoutes, {
      authClient: this.authClient
    });
    this.server.register(ratesRoutes, {
      palClient: this.palClient
    });

    await this.server.listen({ port: PORT, host: HOST });
    console.log(`Admin API listening on ${HOST}:${PORT}`);
  }

  static async stop(): Promise<void> {
    await this.server?.close();
    await this.msgProducer?.disconnect();
    await this.palClient?.disconnect();
    await this.paymentsClient?.disconnect();
    await this.ilpClient?.disconnect();
  }
}
