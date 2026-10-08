'use strict';

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PalClient, parseAddressToDomainAndPathName } from 'pal-client-lib';
import {
  httpStatusFromGrpcError,
  toClientApiErrorResponse,
  PaymentsClient,
  GetPaymentIntentResult,
  CompletePaymentIntentResult,
  CreatePaymentIntentResult
} from 'payments-client-lib';
import { OpenPaymentsResourceServerRouteError } from '../errors.js';
import { components } from '../types/generated/resource-server-types.js';
import { createStreamServer, generateStreamCredentials } from 'ilp-client-lib';
import { randomUUID } from 'crypto';

type StreamServer = ReturnType<typeof createStreamServer>;

interface IncomingPaymentRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
  paymentsClient: PaymentsClient;
  streamServer: StreamServer;
  openPaymentsUrl: string;
}

export function toIncomingPaymentBody(
  paymentIntent: GetPaymentIntentResult | CompletePaymentIntentResult,
  openPaymentsUrl: string
): components['schemas']['incoming-payment'] {
  const { pathName } = parseAddressToDomainAndPathName(
    paymentIntent.receiverWalletAddress
  );

  const body: components['schemas']['incoming-payment'] = {
    id: `${openPaymentsUrl}/incoming-payments/${paymentIntent.id}`,
    completed: paymentIntent.state === 'COMPLETED',
    walletAddress: `${openPaymentsUrl}/${pathName}`,
    createdAt: paymentIntent.createdAt,
    receivedAmount: {
      value: String(paymentIntent.receivedAmount),
      assetCode: paymentIntent.assetCode,
      assetScale: paymentIntent.assetScale
    }
  };

  if (paymentIntent.incomingAmount != null) {
    body.incomingAmount = {
      value: String(paymentIntent.incomingAmount),
      assetCode: paymentIntent.assetCode,
      assetScale: paymentIntent.assetScale
    };
  }

  if (paymentIntent.expiresAt) {
    body.expiresAt = paymentIntent.expiresAt;
  }

  return body;
}

export async function incomingPaymentRoutes(
  server: FastifyInstance,
  opts: IncomingPaymentRouteOptions
): Promise<void> {
  const { palClient, paymentsClient, streamServer, openPaymentsUrl } = opts;

  server.post<{
    Body: components['schemas']['create-incoming-payment-request'];
    Reply:
      | components['schemas']['incoming-payment-with-methods']
      | components['schemas']['error-response'];
  }>(
    '/incoming-payments',
    {
      schema: {
        body: { $ref: '#/components/schemas/create-incoming-payment-request#' }
      }
    },
    async (request, reply) => {
      const {
        walletAddress: walletAddressUrl,
        incomingAmount,
        expiresAt,
        metadata
      } = request.body;

      const id = randomUUID();

      const { domain, pathName } =
        parseAddressToDomainAndPathName(walletAddressUrl);

      const alias = await palClient.resolveWalletAddressAlias(domain, pathName);

      if (!alias) {
        throw new OpenPaymentsResourceServerRouteError(
          400,
          'Wallet address not found',
          'not_found'
        );
      }

      const walletAddresses = await palClient.getWalletAddresses([
        alias.walletAddressId
      ]);

      if (!walletAddresses.length) {
        throw new OpenPaymentsResourceServerRouteError(
          404,
          'Wallet address not found',
          'not_found'
        );
      }

      const walletAddress = walletAddresses[0];

      if (
        incomingAmount &&
        (incomingAmount.assetCode !== walletAddress.assetCode ||
          incomingAmount.assetScale !== walletAddress.assetScale)
      ) {
        throw new OpenPaymentsResourceServerRouteError(
          404,
          'incomingAmount asset does not match wallet address asset',
          'invalid_request'
        );
      }

      let paymentIntent: CreatePaymentIntentResult;
      try {
        paymentIntent = await paymentsClient.createPaymentIntent(
          id,
          walletAddress.id,
          domain ? `${domain}/${pathName}` : pathName,
          incomingAmount ? Number(incomingAmount.value) : undefined,
          expiresAt,
          JSON.stringify(metadata)
        );
      } catch (err) {
        const httpStatus = httpStatusFromGrpcError(err);
        return reply.status(httpStatus).send(toClientApiErrorResponse(err));
      }

      const streamCredentials = generateStreamCredentials(streamServer, {
        paymentIntentId: paymentIntent.id,
        assetCode: paymentIntent.assetCode,
        assetScale: paymentIntent.assetScale
      });

      const response: components['schemas']['incoming-payment-with-methods'] = {
        ...toIncomingPaymentBody(paymentIntent, openPaymentsUrl),
        methods: [
          {
            type: 'ilp',
            ilpAddress: streamCredentials.ilpAddress,
            sharedSecret: streamCredentials.sharedSecret
          }
        ]
      };

      return reply.status(201).send(response);
    }
  );

  server.get<{
    Params: { id: string };
    Reply:
      | components['schemas']['incoming-payment-with-methods']
      | components['schemas']['error-response'];
  }>('/incoming-payments/:id', async (request, reply) => {
    const { id } = request.params;

    let paymentIntent: GetPaymentIntentResult;
    try {
      paymentIntent = await paymentsClient.getPaymentIntent(id);
    } catch (err) {
      const httpStatus = httpStatusFromGrpcError(err);
      return reply.status(httpStatus).send(toClientApiErrorResponse(err));
    }

    const streamCredentials = generateStreamCredentials(streamServer, {
      paymentIntentId: paymentIntent.id,
      assetCode: paymentIntent.assetCode,
      assetScale: paymentIntent.assetScale
    });

    const response: components['schemas']['incoming-payment-with-methods'] = {
      ...toIncomingPaymentBody(paymentIntent, openPaymentsUrl),
      methods: [
        {
          type: 'ilp',
          ilpAddress: streamCredentials.ilpAddress,
          sharedSecret: streamCredentials.sharedSecret
        }
      ]
    };

    return reply.status(200).send(response);
  });

  server.get<{
    Querystring: {
      'wallet-address': string;
      cursor?: string;
      first?: string;
      last?: string;
    };
  }>('/incoming-payments', async (request, reply) => {
    const walletAddressUrl = request.query['wallet-address'];

    if (!walletAddressUrl) {
      throw new OpenPaymentsResourceServerRouteError(
        400,
        "Missing required query parameter 'wallet-address'",
        'invalid_request'
      );
    }

    const { domain, pathName } =
      parseAddressToDomainAndPathName(walletAddressUrl);
    const alias = await palClient.resolveWalletAddressAlias(domain, pathName);

    if (!alias) {
      return reply.status(200).send({
        pagination: { hasNextPage: false, hasPreviousPage: false },
        result: []
      });
    }

    try {
      // Open Payments does not expose a sort order, so it is pinned here
      // rather than inherited from the payments-side default. This ensures
      // consistency with Rafiki.
      const page = await paymentsClient.getPaymentIntentsPage({
        sortOrder: 'desc',
        walletAddressId: alias.walletAddressId,
        cursor: request.query.cursor,
        first:
          request.query.first != null ? Number(request.query.first) : undefined,
        last:
          request.query.last != null ? Number(request.query.last) : undefined
      });

      return reply.status(200).send({
        pagination: page.pagination,
        result: page.items.map((item) =>
          toIncomingPaymentBody(item, openPaymentsUrl)
        )
      });
    } catch (err) {
      const httpStatus = httpStatusFromGrpcError(err);
      return reply.status(httpStatus).send(toClientApiErrorResponse(err));
    }
  });

  server.post<{
    Params: { id: string };
    Reply:
      | components['schemas']['incoming-payment']
      | components['schemas']['error-response'];
  }>('/incoming-payments/:id/complete', async (request, reply) => {
    const { id } = request.params;

    let paymentIntent: CompletePaymentIntentResult;
    try {
      paymentIntent = await paymentsClient.completePaymentIntent(id);
    } catch (err) {
      const httpStatus = httpStatusFromGrpcError(err);
      return reply.status(httpStatus).send(toClientApiErrorResponse(err));
    }

    const response: components['schemas']['incoming-payment'] =
      toIncomingPaymentBody(paymentIntent, openPaymentsUrl);

    return reply.status(200).send(response);
  });
}
