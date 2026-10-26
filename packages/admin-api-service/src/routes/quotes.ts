'use strict';

import { CreateQuoteRequest } from 'admin-client-lib';
import { randomUUID } from 'crypto';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PalClient, pathNameFromWalletAddress } from 'pal-client-lib';
import { PaymentsClient } from 'payments-client-lib';

interface QuoteRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
  paymentsClient: PaymentsClient;
}

export async function quoteRoutes(
  server: FastifyInstance,
  opts: QuoteRouteOptions
): Promise<void> {
  const { palClient, paymentsClient } = opts;

  server.post<{
    Body: CreateQuoteRequest;
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

    const result = await paymentsClient.createQuote(
      id,
      paymentIntent,
      wallet.id,
      walletAddress,
      debitAmount ? Number(debitAmount) : undefined,
      receiveAmount ? Number(receiveAmount) : undefined
    );

    return reply.status(201).send({
      id: result.id,
      paymentIntentId: result.paymentIntentId,
      senderWalletAddress: result.senderWalletAddress,
      senderWalletAddressId: result.senderWalletAddressId,
      expiresAt: result.expiresAt,
      debitAmount: String(result.debitAmount),
      receiveAmount: String(result.receiveAmount),
      exchangeRate: result.exchangeRate
    });
  });
}
