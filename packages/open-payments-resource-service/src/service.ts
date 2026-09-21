'use strict';

import Fastify, { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { PalClient } from 'pal-client-lib';
import { PaymentsClient } from 'payments-client-lib';
import { createStreamServer, parseStreamServerSecret } from 'ilp-client-lib';
import { walletAddressRoutes } from './routes/wallet-addresses.js';
import { incomingPaymentRoutes } from './routes/incoming-payments.js';

import resourceServerOpenApiJsonSchema from '../../../open-payments-specifications/json/resource-server.json';
import { errorHandler } from './errors.js';
import { quoteRoutes } from './routes/quotes.js';

import { FastifyOpenApiValidator } from './validator.js';
import crypto from 'crypto';
import { ILogger } from '../../common-types-lib/dist/logger.js';
import { PinoLogger } from 'implementations-lib';

const BC_NAME = 'OPEN_PAYMENTS';
const APP_NAME = `${BC_NAME}_API_SVC`;
const INSTANCE_ID = `${APP_NAME}_${crypto.randomUUID()}`;

const PORT = parseInt(process.env['PORT'] || '3002', 10);
const HOST = process.env['HOST'] || '0.0.0.0';
const PAL_GRPC_URL = process.env['PAL_GRPC_URL'] || 'localhost:50051';
const PAYMENTS_GRPC_URL = process.env['PAYMENTS_GRPC_URL'] || 'localhost:50052';
const OPEN_PAYMENTS_RESOURCE_SERVICE_URL =
  process.env['OPEN_PAYMENTS_RESOURCE_SERVICE_URL'] || 'localhost:3002';
const OPEN_PAYMENTS_AUTH_SERVICE_URL =
  process.env['OPEN_PAYMENTS_AUTH_SERVICE_URL'] || 'localhost:3002';

const STREAM_SERVER_SECRET_RAW =
  process.env['STREAM_SERVER_SECRET'] ||
  Buffer.from('rafiki-v2-dev-stream-secret-0001').toString('base64url');
const ILP_ADDRESS = process.env['ILP_ADDRESS'] || 'private.rafiki';

export class OpenPaymentsResourceServer {
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
      OPEN_PAYMENTS_RESOURCE_SERVICE_URL
    );
    await this.paymentsClient.init();
    console.log(`Connected to Payments service at ${PAYMENTS_GRPC_URL}`);

    this.server = Fastify({
      // If logger is not a PinoLogger, enable Fastify's default logging
      logger: PinoLogger.isPinoLogger(this.logger) ? undefined : true,
      loggerInstance: PinoLogger.isPinoLogger(this.logger)
        ? (this.logger.internalLogger as FastifyBaseLogger)
        : undefined
    });

    const validator = new FastifyOpenApiValidator(
      resourceServerOpenApiJsonSchema
    );

    validator.addFormat('uint64', {
      validate: (data: string) => {
        try {
          const value = BigInt(data);
          return value >= BigInt(0);
        } catch {
          return false;
        }
      }
    });
    this.server.setValidatorCompiler(({ schema }) => validator.compile(schema));

    this.server.setErrorHandler(errorHandler);

    this.server.register(incomingPaymentRoutes, {
      palClient: this.palClient,
      paymentsClient: this.paymentsClient,
      streamServer: createStreamServer({
        serverSecret: parseStreamServerSecret(STREAM_SERVER_SECRET_RAW),
        serverAddress: ILP_ADDRESS
      })
    });

    this.server.register(quoteRoutes, {
      palClient: this.palClient,
      paymentsClient: this.paymentsClient
    });

    this.server.register(walletAddressRoutes, {
      palClient: this.palClient,
      openPaymentsResourceServiceUrl: OPEN_PAYMENTS_RESOURCE_SERVICE_URL,
      openPaymentsAuthServiceUrl: OPEN_PAYMENTS_AUTH_SERVICE_URL
    });

    await this.server.listen({ port: PORT, host: HOST });
    console.log(
      `Open Payments Resource Server API listening on ${HOST}:${PORT}`
    );
  }

  static async stop(): Promise<void> {
    await this.server?.close();
    await this.palClient?.disconnect();
    await this.paymentsClient?.disconnect();
  }
}
