'use strict';

import { QuoteCreate } from 'admin-client-lib';
import { randomUUID } from 'crypto';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PalClient, parseAddressToDomainAndPathName } from 'pal-client-lib';
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
    Body: QuoteCreate;
  }>('/quotes', async (request, reply) => {
    const {
      walletAddress,
      debitAmount,
      receiveAmount,
      paymentIntentId,
      paymentIntentUrl
    } = request.body;

    let incomingPayment:
      | { incomingPaymentUrl: string }
      | { incomingPaymentId: string };
    if (paymentIntentUrl) {
      incomingPayment = { incomingPaymentUrl: paymentIntentUrl };
    } else if (paymentIntentId) {
      incomingPayment = { incomingPaymentId: paymentIntentId };
    } else {
      return reply.status(400).send({
        error: 'Either paymentIntentId or paymentIntentUrl is required'
      });
    }

    const id = request.body.id ?? randomUUID();

    const { domain, pathName } = parseAddressToDomainAndPathName(walletAddress);
    const alias = await palClient.resolveWalletAddressAlias(domain, pathName);
    if (!alias) {
      return reply
        .status(404)
        .send({ error: `Wallet address '${walletAddress}' not found` });
    }

    const result = await paymentsClient.createQuote(
      id,
      incomingPayment,
      alias.walletAddressId,
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
