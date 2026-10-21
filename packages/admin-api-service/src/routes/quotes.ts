'use strict';

import {
  ErrorResponse,
  GetQuoteRequest,
  CompletedQuote,
  PendingQuote,
  FailedQuote,
  CreateQuoteRequest
} from 'admin-client-lib';
import { randomUUID } from 'crypto';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PalClient, parseAddressToDomainAndPathName } from 'pal-client-lib';
import {
  CreateQuoteResult,
  GetQuoteResult,
  PaymentsClient,
  httpStatusFromGrpcError,
  toClientApiErrorResponse
} from 'payments-client-lib';

interface QuoteRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
  paymentsClient: PaymentsClient;
}

function toQuoteBody(
  result: GetQuoteResult | CreateQuoteResult
): CompletedQuote | PendingQuote | FailedQuote {
  const base = {
    id: result.id,
    paymentIntentId: result.paymentIntentId,
    senderWalletAddress: result.senderWalletAddress,
    senderWalletAddressId: result.senderWalletAddressId,
    createdAt: new Date(result.createdAt),
    state: 'state' in result ? result.state : 'COMPLETED'
  };

  switch (base.state) {
    case 'COMPLETED': {
      const completed: CompletedQuote = {
        ...base,
        state: 'COMPLETED'
      };
      if (result.expiresAt !== undefined) {
        completed.expiresAt = new Date(result.expiresAt);
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
      const pending: PendingQuote = {
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
      const failed: FailedQuote = {
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
    Body: CreateQuoteRequest;
    Reply: CompletedQuote | ErrorResponse;
  }>('/quotes', async (request, reply) => {
    const { walletAddress, debitAmount, receiveAmount } = request.body;
    const paymentIntent =
      'paymentIntentUrl' in request.body
        ? { paymentIntentUrl: request.body.paymentIntentUrl }
        : { paymentIntentId: request.body.paymentIntentId };

    const id = request.body.id ?? randomUUID();

    const { domain, pathName } = parseAddressToDomainAndPathName(walletAddress);
    const alias = await palClient.resolveWalletAddressAlias(domain, pathName);
    if (!alias) {
      return reply
        .status(404)
        .send({ error: `Wallet address '${walletAddress}' not found` });
    }

    try {
      const result = await paymentsClient.createQuote(
        id,
        paymentIntent,
        alias.walletAddressId,
        walletAddress,
        debitAmount ? Number(debitAmount) : undefined,
        receiveAmount ? Number(receiveAmount) : undefined
      );
      return reply.status(201).send(toQuoteBody(result) as CompletedQuote);
    } catch (err) {
      server.log.error(err);
      const httpStatus = httpStatusFromGrpcError(err);
      const { error } = toClientApiErrorResponse(err);
      return reply.status(httpStatus).send({ error: error.description });
    }
  });

  server.get<{
    Params: GetQuoteRequest;
    Reply: CompletedQuote | PendingQuote | FailedQuote | ErrorResponse;
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
