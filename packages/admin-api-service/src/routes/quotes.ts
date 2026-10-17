'use strict';

import {
  ErrorResponse,
  GetQuoteRequest,
  Quote,
  QuoteState,
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

function toQuoteBody(result: CreateQuoteResult | GetQuoteResult): Quote {
  // CreateQuoteResult has no state but a successful create quote is always in a COMPLETED state
  const quote: GetQuoteResult = {
    ...result,
    state: 'state' in result ? result.state : 'COMPLETED'
  };

  const body: Quote = {
    id: quote.id,
    paymentIntentId: quote.paymentIntentId,
    senderWalletAddress: quote.senderWalletAddress,
    senderWalletAddressId: quote.senderWalletAddressId,
    createdAt: new Date(quote.createdAt),
    state: quote.state as QuoteState
  };

  switch (quote.state) {
    case 'COMPLETED':
      if (quote.expiresAt !== undefined) {
        body.expiresAt = new Date(quote.expiresAt);
      }
      if (quote.debitAmount !== undefined) {
        body.debitAmount = String(quote.debitAmount);
      }
      if (quote.receiveAmount !== undefined) {
        body.receiveAmount = String(quote.receiveAmount);
      }
      if (quote.exchangeRate !== undefined) {
        body.exchangeRate = quote.exchangeRate;
      }
      break;
    case 'PENDING':
      if (quote.debitAmount !== undefined) {
        body.debitAmount = String(quote.debitAmount);
      }
      if (quote.receiveAmount !== undefined) {
        body.receiveAmount = String(quote.receiveAmount);
      }
      if (quote.sourceAmount !== undefined) {
        body.sourceAmount = String(quote.sourceAmount);
      }
      if (quote.senderAssetCode !== undefined) {
        body.senderAssetCode = quote.senderAssetCode;
      }
      break;
    case 'FAILED':
      if (quote.errorName !== undefined) {
        body.errorName = quote.errorName;
      }
      if (quote.message !== undefined) {
        body.message = quote.message;
      }
      break;
  }

  return body;
}

export async function quoteRoutes(
  server: FastifyInstance,
  opts: QuoteRouteOptions
): Promise<void> {
  const { palClient, paymentsClient } = opts;

  server.post<{
    Body: CreateQuoteRequest;
    Reply: Quote | ErrorResponse;
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
      return reply.status(201).send(toQuoteBody(result));
    } catch (err) {
      server.log.error(err);
      const httpStatus = httpStatusFromGrpcError(err);
      const { error } = toClientApiErrorResponse(err);
      return reply.status(httpStatus).send({ error: error.description });
    }
  });

  server.get<{
    Params: GetQuoteRequest;
    Reply: Quote | ErrorResponse;
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
