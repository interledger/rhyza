'use strict';

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
    Body: {
      walletAddress: string;
      id?: string;
      incomingPaymentId?: string;
      incomingPaymentUrl?: string;
      debitAmount?: string;
      receiveAmount?: string;
    };
  }>('/quotes', async (request, reply) => {
    const {
      walletAddress,
      debitAmount,
      receiveAmount,
      incomingPaymentId,
      incomingPaymentUrl
    } = request.body;

    let incomingPayment:
      | { incomingPaymentUrl: string }
      | { incomingPaymentId: string };
    if (incomingPaymentUrl) {
      incomingPayment = { incomingPaymentUrl };
    } else if (incomingPaymentId) {
      incomingPayment = { incomingPaymentId };
    } else {
      return reply.status(400).send({
        error: 'Either incomingPaymentId or incomingPaymentUrl is required'
      });
    }

    const id = request.body.id ?? randomUUID();

    const { domain, pathName } = parseAddressToDomainAndPathName(walletAddress);
    const alias = await palClient.ResolveWalletAddressAlias(domain, pathName);
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
      Number(debitAmount),
      Number(receiveAmount)
    );

    return reply
      .status(201)
      .send({ id: `${result.paymentIntentId}_${result.id}` }); // Concatenate ids when returning the request
  });
}
