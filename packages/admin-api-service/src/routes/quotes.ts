'use strict';

import { randomUUID } from 'crypto';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PalClient, pathNameFromWalletAddress } from 'pal-client-lib';
import {
  CreateQuoteResult,
  GetQuoteResult,
  PaymentsClient,
  httpStatusFromGrpcError,
  toClientApiErrorResponse
} from 'payments-client-lib';
import type {
  components,
  operations
} from '../types/generated/admin-api-types.js';

interface QuoteRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
  paymentsClient: PaymentsClient;
}

function toQuoteBody(
  result: GetQuoteResult | CreateQuoteResult
):
  | components['schemas']['CompletedQuote']
  | components['schemas']['PendingQuote']
  | components['schemas']['FailedQuote'] {
  const base = {
    id: result.id,
    paymentIntentId: result.paymentIntentId,
    senderWalletAddress: result.senderWalletAddress,
    senderWalletAddressId: result.senderWalletAddressId,
    createdAt: new Date(result.createdAt).toISOString(),
    state: 'state' in result ? result.state : 'COMPLETED'
  };

  switch (base.state) {
    case 'COMPLETED': {
      const completed: components['schemas']['CompletedQuote'] = {
        ...base,
        state: 'COMPLETED'
      };
      if (result.expiresAt !== undefined) {
        completed.expiresAt = new Date(result.expiresAt).toISOString();
      }
      if (result.debitAmount !== undefined) {
        completed.debitAmount = String(result.debitAmount);
      }
      if (result.receiveAmount !== undefined) {
        completed.receiveAmount = String(result.receiveAmount);
      }
      if (result.exchangeRate !== undefined) {
        completed.exchangeRate = result.exchangeRate;
      }
      return completed;
    }
    case 'PENDING': {
      result = result as GetQuoteResult;
      const pending: components['schemas']['PendingQuote'] = {
        ...base,
        state: 'PENDING'
      };
      if (result.debitAmount !== undefined) {
        pending.debitAmount = String(result.debitAmount);
      }
      if (result.receiveAmount !== undefined) {
        pending.receiveAmount = String(result.receiveAmount);
      }
      if (result.sourceAmount !== undefined) {
        pending.sourceAmount = String(result.sourceAmount);
      }
      if (result.senderAssetCode !== undefined) {
        pending.senderAssetCode = result.senderAssetCode;
      }
      return pending;
    }
    case 'FAILED': {
      result = result as GetQuoteResult;
      const failed: components['schemas']['FailedQuote'] = {
        ...base,
        state: 'FAILED'
      };
      if (result.errorName !== undefined) {
        failed.errorName = result.errorName;
      }
      if (result.message !== undefined) {
        failed.message = result.message;
      }
      return failed;
    }
    default:
      throw new Error(`Unexpected quote state: ${base.state}`);
  }
}

export async function quoteRoutes(
  server: FastifyInstance,
  opts: QuoteRouteOptions
): Promise<void> {
  const { palClient, paymentsClient } = opts;

  server.post<{
    Body: operations['createQuote']['requestBody']['content']['application/json'];
    Reply:
      | components['schemas']['CompletedQuote']
      | components['schemas']['ErrorResponse'];
  }>('/quotes', async (request, reply) => {
    const { walletAddress, debitAmount, receiveAmount } = request.body;
    const paymentIntent =
      'paymentIntentUrl' in request.body
        ? { paymentIntentUrl: request.body.paymentIntentUrl }
        : { paymentIntentId: request.body.paymentIntentId };

    const id = request.body.id ?? randomUUID();

    const pathName = pathNameFromWalletAddress(walletAddress);

    const wallet = await palClient.resolveWalletAddressByAlias(null, pathName);
    if (!wallet) {
      return reply
        .status(404)
        .send({ error: `Wallet address '${walletAddress}' not found` });
    }

    try {
      const result = await paymentsClient.createQuote(
        id,
        paymentIntent,
        wallet.id,
        walletAddress,
        debitAmount ? Number(debitAmount) : undefined,
        receiveAmount ? Number(receiveAmount) : undefined
      );
      return reply
        .status(201)
        .send(toQuoteBody(result) as components['schemas']['CompletedQuote']);
    } catch (err) {
      server.log.error(err);
      const httpStatus = httpStatusFromGrpcError(err);
      const { error } = toClientApiErrorResponse(err);
      return reply.status(httpStatus).send({ error: error.description });
    }
  });

  server.get<{
    Params: operations['getQuote']['parameters']['path'];
    Reply:
      | components['schemas']['CompletedQuote']
      | components['schemas']['PendingQuote']
      | components['schemas']['FailedQuote']
      | components['schemas']['ErrorResponse'];
  }>('/payment-intents/:intentId/quotes/:id', async (request, reply) => {
    const { intentId, id } = request.params;

    try {
      const quote = await paymentsClient.getQuote(intentId, id);
      return reply.status(200).send(toQuoteBody(quote));
    } catch (err) {
      server.log.error(err);
      const httpStatus = httpStatusFromGrpcError(err);
      const { error } = toClientApiErrorResponse(err);
      return reply.status(httpStatus).send({ error: error.description });
    }
  });
}
