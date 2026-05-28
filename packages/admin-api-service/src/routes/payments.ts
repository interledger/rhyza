'use strict';

import { randomUUID } from 'crypto';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PalClient, parseAddressToDomainAndPathName } from 'pal-client-lib';
import { PaymentsClient, PaymentNotFoundError } from 'payments-client-lib';

interface PaymentRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
  paymentsClient: PaymentsClient;
}

export async function paymentRoutes(
  server: FastifyInstance,
  opts: PaymentRouteOptions
): Promise<void> {
  const { palClient, paymentsClient } = opts;

  server.post<{
    Body: {
      walletAddress: string;
      paymentIntentId: string;
      id?: string;
      quoteId?: string;
      debitAmount?: number;
    };
  }>('/payments', async (request, reply) => {
    const { walletAddress, paymentIntentId, quoteId, debitAmount } =
      request.body;

    const id = request.body.id ?? randomUUID();

    const { domain, pathName } = parseAddressToDomainAndPathName(walletAddress);
    const alias = await palClient.ResolveWalletAddressAlias(domain, pathName);
    if (!alias) {
      return reply
        .status(404)
        .send({ error: `Wallet address '${walletAddress}' not found` });
    }

    const result = await paymentsClient.createPayment(
      id,
      alias.walletAddressId,
      walletAddress,
      paymentIntentId,
      quoteId,
      debitAmount ? Number(debitAmount) : undefined
    );

    return reply.status(201).send({ id: result.id, paymentIntentId });
  });

  server.get<{ Params: { intentId: string; id: string } }>(
    '/payment-intents/:intentId/payments/:id',
    async (request, reply) => {
      const { intentId, id } = request.params;

      let payment;
      try {
        payment = await paymentsClient.getPayment(intentId, id);
      } catch (err) {
        if (err instanceof PaymentNotFoundError) {
          return reply.status(404).send({ error: `Payment '${id}' not found` });
        }
        throw err;
      }

      return reply.status(200).send({
        id: payment.id,
        state: payment.state,
        senderWalletAddress: payment.senderWalletAddress,
        assetCode: payment.assetCode,
        assetScale: payment.assetScale,
        quoteId: payment.quoteId,
        debitAmount: String(payment.debitAmount),
        receiveAmount: String(payment.receiveAmount),
        sentAmount: String(payment.sentAmount)
      });
    }
  );

  server.post<{
    Params: { intentId: string; id: string };
  }>(
    '/payment-intents/:intentId/payments/:id/approve',
    async (request, reply) => {
      const { intentId, id } = request.params;

      try {
        await paymentsClient.approvePayment(intentId, id);
        return reply.status(200).send({ id });
      } catch (err) {
        server.log.error(err);
        return reply.status(500).send({ error: (err as Error).message });
      }
    }
  );
}
