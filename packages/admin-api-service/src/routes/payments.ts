'use strict';

import { randomUUID } from 'crypto';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PalClient, pathNameFromWalletAddress } from 'pal-client-lib';
import {
  ApprovePaymentRequest,
  CancelPaymentRequest,
  GetPaymentRequest,
  PaymentCancel,
  PaymentCreate,
  PaymentsListPaymentsRequest
} from 'admin-client-lib';
import {
  IAmount,
  PaymentsClient,
  GetPaymentResult,
  httpStatusFromGrpcError,
  toClientApiErrorResponse
} from 'payments-client-lib';
import { parsePageQuery } from '../pagination.js';

interface PaymentRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
  paymentsClient: PaymentsClient;
}

interface AmountBody {
  value: string;
  assetCode: string;
  assetScale: number;
}

interface PaymentBody {
  id: string;
  state: string;
  paymentIntentId: string;
  senderWalletAddress: string;
  quoteId?: string;
  debitAmount: AmountBody;
  receiveAmount: AmountBody;
  sentAmount: AmountBody;
  createdAt: string;
  failReason?: string;
  metadata?: Record<string, unknown>;
}

function toAmountBody(amount: IAmount): AmountBody {
  return {
    value: String(amount.value),
    assetCode: amount.assetCode,
    assetScale: amount.assetScale
  };
}

function toPaymentBody(payment: GetPaymentResult): PaymentBody {
  const body: PaymentBody = {
    id: payment.id,
    state: payment.state,
    paymentIntentId: payment.paymentIntentId,
    senderWalletAddress: payment.senderWalletAddress,
    debitAmount: toAmountBody(payment.debitAmount),
    receiveAmount: toAmountBody(payment.receiveAmount),
    sentAmount: toAmountBody(payment.sentAmount),
    createdAt: payment.createdAt
  };

  if (payment.quoteId) {
    body.quoteId = payment.quoteId;
  }

  if (payment.failReason) {
    body.failReason = payment.failReason;
  }

  if (payment.metadata) {
    body.metadata = payment.metadata;
  }

  return body;
}

export async function paymentRoutes(
  server: FastifyInstance,
  opts: PaymentRouteOptions
): Promise<void> {
  const { palClient, paymentsClient } = opts;

  server.post<{
    Body: PaymentCreate;
  }>('/payments', async (request, reply) => {
    const { walletAddress, paymentIntentId, quoteId, debitAmount, metadata } =
      request.body;

    const id = request.body.id ?? randomUUID();

    const pathName = pathNameFromWalletAddress(walletAddress);
    const alias = await palClient.resolveWalletAddressAlias(null, pathName);
    if (!alias) {
      return reply
        .status(404)
        .send({ error: `Wallet address '${walletAddress}' not found` });
    }

    try {
      const result = await paymentsClient.createPayment(
        id,
        alias.walletAddressId,
        walletAddress,
        paymentIntentId,
        quoteId,
        debitAmount ? Number(debitAmount) : undefined,
        undefined,
        metadata
      );

      return reply.status(201).send({ id: result.id, paymentIntentId });
    } catch (err) {
      server.log.error(err);
      const httpStatus = httpStatusFromGrpcError(err);
      const { error } = toClientApiErrorResponse(err);
      return reply.status(httpStatus).send({ error: error.description });
    }
  });

  server.get<{ Querystring: PaymentsListPaymentsRequest }>(
    '/payments',
    async (request, reply) => {
      try {
        const page = await paymentsClient.getPaymentsPage({
          ...parsePageQuery(request.query),
          paymentIntentId: request.query.paymentIntentId
        });

        return reply.status(200).send({
          result: page.items.map(toPaymentBody),
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

  server.get<{ Params: GetPaymentRequest }>(
    '/payment-intents/:intentId/payments/:id',
    async (request, reply) => {
      const { intentId, id } = request.params;

      let payment;
      try {
        payment = await paymentsClient.getPayment(intentId, id);
      } catch (err) {
        server.log.error(err);
        const httpStatus = httpStatusFromGrpcError(err);
        const { error } = toClientApiErrorResponse(err);
        return reply.status(httpStatus).send({ error: error.description });
      }

      return reply.status(200).send(toPaymentBody(payment));
    }
  );

  server.post<{
    Params: ApprovePaymentRequest;
  }>(
    '/payment-intents/:intentId/payments/:id/approve',
    async (request, reply) => {
      const { id, intentId } = request.params;

      try {
        const result = await paymentsClient.approvePayment(intentId, id);
        return reply.status(200).send({ id: result.id, state: result.state });
      } catch (err) {
        server.log.error(err);
        const httpStatus = httpStatusFromGrpcError(err);
        const { error } = toClientApiErrorResponse(err);
        return reply.status(httpStatus).send({ error: error.description });
      }
    }
  );

  server.post<{
    Params: CancelPaymentRequest;
    Body: PaymentCancel;
  }>(
    '/payment-intents/:intentId/payments/:id/cancel',
    async (request, reply) => {
      const { id, intentId } = request.params;
      const { reason } = request.body ?? {};

      try {
        await paymentsClient.cancelPayment(intentId, id, reason);
        return reply.status(200).send({ id });
      } catch (err) {
        server.log.error(err);
        const httpStatus = httpStatusFromGrpcError(err);
        const { error } = toClientApiErrorResponse(err);
        return reply.status(httpStatus).send({ error: error.description });
      }
    }
  );
}
