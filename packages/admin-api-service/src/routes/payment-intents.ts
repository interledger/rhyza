'use strict';

import {
  GetPaymentIntentRequest,
  PaymentIntentCreate,
  PaymentIntentsListPaymentIntentsRequest,
  CompletePaymentIntentRequest
} from 'admin-client-lib';
import { randomUUID } from 'crypto';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PalClient, pathNameFromWalletAddress } from 'pal-client-lib';
import {
  PaymentsClient,
  GetPaymentIntentResult,
  httpStatusFromGrpcError,
  toClientApiErrorResponse
} from 'payments-client-lib';
import { parsePageQuery } from '../pagination.js';

interface PaymentIntentRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
  paymentsClient: PaymentsClient;
  openPaymentsUrl: string | undefined;
}

interface AmountBody {
  value: string;
  assetCode: string;
  assetScale: number;
}

interface PaymentIntentBody {
  id: string;
  state: string;
  destination: string;
  walletAddress: string;
  incomingAmount?: AmountBody;
  receivedAmount: AmountBody;
  expiresAt?: string;
  destinationIlpAddress?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

function toPaymentIntentBody(
  paymentIntent: GetPaymentIntentResult
): PaymentIntentBody {
  const body: PaymentIntentBody = {
    id: paymentIntent.id,
    state: paymentIntent.state,
    destination: paymentIntent.destination,
    walletAddress: paymentIntent.receiverWalletAddress,
    receivedAmount: {
      value: String(paymentIntent.receivedAmount),
      assetCode: paymentIntent.assetCode,
      assetScale: paymentIntent.assetScale
    },
    createdAt: paymentIntent.createdAt
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

  if (paymentIntent.destinationIlpAddress) {
    body.destinationIlpAddress = paymentIntent.destinationIlpAddress;
  }

  if (paymentIntent.metadata) {
    body.metadata = paymentIntent.metadata;
  }

  return body;
}

export async function paymentIntentRoutes(
  server: FastifyInstance,
  opts: PaymentIntentRouteOptions
): Promise<void> {
  const { palClient, paymentsClient, openPaymentsUrl } = opts;

  server.post<{
    Body: PaymentIntentCreate;
  }>('/payment-intents', async (request, reply) => {
    const { walletAddress, incomingAmount, expiresAt, metadata } = request.body;

    const id = request.body.id ?? randomUUID();

    const pathName = pathNameFromWalletAddress(walletAddress);

    const alias = await palClient.resolveWalletAddressAlias(null, pathName);

    if (!alias) {
      return reply
        .status(404)
        .send({ error: `Wallet address '${walletAddress}' not found` });
    }

    try {
      const result = await paymentsClient.createPaymentIntent(
        id,
        alias.walletAddressId,
        walletAddress,
        incomingAmount ? Number(incomingAmount) : undefined,
        expiresAt?.toISOString(),
        metadata
      );

      const response: { id: string; openPaymentsUrl?: string } = {
        id: result.id
      };

      if (openPaymentsUrl) {
        response.openPaymentsUrl = `${openPaymentsUrl}/incoming-payments/${result.id}`;
      }

      return reply.status(201).send(response);
    } catch (err) {
      server.log.error(err);
      const httpStatus = httpStatusFromGrpcError(err);
      const { error } = toClientApiErrorResponse(err);
      return reply.status(httpStatus).send({ error: error.description });
    }
  });

  server.get<{ Querystring: PaymentIntentsListPaymentIntentsRequest }>(
    '/payment-intents',
    async (request, reply) => {
      try {
        const page = await paymentsClient.getPaymentIntentsPage(
          parsePageQuery(request.query)
        );

        return reply.status(200).send({
          result: page.items.map(toPaymentIntentBody),
          pagination: page.pagination
        });
      } catch (err) {
        server.log.error(err);
        const httpStatus = httpStatusFromGrpcError(err);
        const { error } = toClientApiErrorResponse(err);
        return reply.status(httpStatus).send({ error: error.description });
      }
    }
  );

  server.get<{
    Params: GetPaymentIntentRequest;
  }>('/payment-intents/:id', async (request, reply) => {
    const { id } = request.params;

    let paymentIntent;
    try {
      paymentIntent = await paymentsClient.getPaymentIntent(id);
    } catch (err) {
      server.log.error(err);
      const httpStatus = httpStatusFromGrpcError(err);
      const { error } = toClientApiErrorResponse(err);
      return reply.status(httpStatus).send({ error: error.description });
    }

    return reply.status(200).send(toPaymentIntentBody(paymentIntent));
  });

  server.post<{
    Params: CompletePaymentIntentRequest;
    Body: { reason?: string };
  }>('/payment-intents/:id/complete', async (request, reply) => {
    const { id } = request.params;

    try {
      const result = await paymentsClient.completePaymentIntent(id);
      return reply.status(200).send({ id, state: result.state });
    } catch (err) {
      server.log.error(err);
      const httpStatus = httpStatusFromGrpcError(err);
      const { error } = toClientApiErrorResponse(err);
      return reply.status(httpStatus).send({ error: error.description });
    }
  });
}
