'use strict';

import Fastify, { FastifyBaseLogger, FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import { Redis } from 'ioredis';
import { AuthClient } from 'auth-client-lib';
import { grantRoutes } from './routes/grant';
import { tokenRoutes } from './routes/token';
import { interactionRoutes } from './routes/interaction';

import authServerOpenApiJsonSchema from '../../../open-payments-specifications/json/auth-server.json';
import { errorHandler } from './errors';
import { allowEmptyJsonBody } from './utils';

import { FastifyOpenApiValidator } from './validator';
import crypto from 'crypto';
import { ILogger } from 'common-types-lib';
import { PinoLogger, RedisCache } from 'implementations-lib';
import { CacheSessionStore } from './session-store';

const BC_NAME = 'OPEN_PAYMENTS';
const APP_NAME = `${BC_NAME}_AUTH_SVC`;
const INSTANCE_ID = `${APP_NAME}_${crypto.randomUUID()}`;

const PORT = parseInt(process.env['PORT'] || '3003', 10);
const HOST = process.env['HOST'] || '0.0.0.0';
const AUTH_GRPC_URL = process.env['AUTH_GRPC_URL'] || 'localhost:50054';
const OPEN_PAYMENTS_AUTH_SERVER_URL =
  process.env['OPEN_PAYMENTS_AUTH_SERVER_URL'] || 'http://localhost:3003';
// TODO: validate that this is set on startup
const IDP_URL = process.env['IDP_URL'] as string;
const REDIS_URL = process.env['REDIS_URL'];
const SESSION_SECRET = process.env['SESSION_SECRET'];
// Matches the grant's interaction expiry, so a session never outlives it
const SESSION_TTL_MS = parseInt(process.env['SESSION_TTL_MS'] || '600000', 10);

declare module 'fastify' {
  interface FastifyRequest {
    gnapToken: string | null;
  }

  interface Session {
    interactionSessionId: string;
  }
}
export class OpenPaymentsAuthServer {
  private static logger: ILogger;
  private static server: FastifyInstance;
  private static authClient: AuthClient;
  private static redis?: Redis;

  static async start(): Promise<void> {
    this.logger = new PinoLogger({
      bcName: BC_NAME,
      appName: APP_NAME,
      instanceId: INSTANCE_ID
    });

    if (!REDIS_URL) {
      const message =
        'REDIS_URL is not set; refusing to start without a shared session store';
      this.logger.error(message);
      throw new Error(message);
    }
    if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
      const message =
        'SESSION_SECRET must be set to at least 32 characters; refusing to start';
      this.logger.error(message);
      throw new Error(message);
    }

    this.redis = new Redis(REDIS_URL, { lazyConnect: true });
    await this.redis.connect();
    console.log(`Connected to Redis at ${REDIS_URL}`);

    this.authClient = new AuthClient(AUTH_GRPC_URL);
    await this.authClient.init();
    console.log(`Connected to Auth service at ${AUTH_GRPC_URL}`);

    this.server = Fastify({
      // If logger is not a PinoLogger, enable Fastify's default logging
      logger: PinoLogger.isPinoLogger(this.logger) ? undefined : true,
      loggerInstance: PinoLogger.isPinoLogger(this.logger)
        ? (this.logger.internalLogger as FastifyBaseLogger)
        : undefined,
      trustProxy: process.env.TRUST_PROXY ?? true
    });

    const validator = new FastifyOpenApiValidator(authServerOpenApiJsonSchema);
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

    allowEmptyJsonBody(this.server);

    this.server.register(fastifyCookie);
    this.server.register(fastifySession, {
      cookieName: 'interactionSessionId',
      secret: SESSION_SECRET,
      store: new CacheSessionStore(
        new RedisCache(this.redis, this.logger.child('session-store')),
        SESSION_TTL_MS
      ),
      // only the interaction start route writes to the session
      saveUninitialized: false,
      cookie: { maxAge: SESSION_TTL_MS }
    });

    this.server.register(grantRoutes, {
      authClient: this.authClient,
      openPaymentsAuthServerUrl: OPEN_PAYMENTS_AUTH_SERVER_URL
    });
    this.server.register(tokenRoutes, {
      authClient: this.authClient,
      openPaymentsAuthServerUrl: OPEN_PAYMENTS_AUTH_SERVER_URL
    });
    this.server.register(interactionRoutes, {
      authClient: this.authClient,
      openPaymentsAuthServerUrl: OPEN_PAYMENTS_AUTH_SERVER_URL,
      idpUrl: IDP_URL
    });

    await this.server.listen({ port: PORT, host: HOST });
    console.log(`Open Payments Auth Server API listening on ${HOST}:${PORT}`);
  }

  static async stop(): Promise<void> {
    await this.server?.close();
    await this.authClient?.disconnect();
    await this.redis?.quit();
  }
}
