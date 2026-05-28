'use strict';

import { randomUUID } from 'crypto';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PalClient, parseAddressToDomainAndPathName } from 'pal-client-lib';
import {
  PaymentsClient,
  PaymentIntentNotFoundError
} from 'payments-client-lib';

interface PaymentIntentRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
  paymentsClient: PaymentsClient;
  openPaymentsUrl: string | undefined;
}

export async function paymentIntentRoutes(
  server: FastifyInstance,
  opts: PaymentIntentRouteOptions
): Promise<void> {
  const { palClient, paymentsClient, openPaymentsUrl } = opts;

  server.post<{
    Body: {
      walletAddress: string;
      id?: string;
      incomingAmount?: number;
      expiresAt?: string;
      metadata?: string;
    };
  }>('/payment-intents', async (request, reply) => {
    const { walletAddress, incomingAmount, expiresAt, metadata } = request.body;

    const id = request.body.id ?? randomUUID();

    const { domain, pathName } = parseAddressToDomainAndPathName(walletAddress);

    const alias = await palClient.ResolveWalletAddressAlias(domain, pathName);

    if (!alias) {
      return reply
        .status(404)
        .send({ error: `Wallet address '${walletAddress}' not found` });
    }

    const result = await paymentsClient.createPaymentIntent(
      id,
      alias.walletAddressId,
      walletAddress,
      incomingAmount ? Number(incomingAmount) : undefined,
      expiresAt,
      metadata
    );

    const response: { id: string; openPaymentsUrl?: string } = {
      id: result.id
    };

    if (openPaymentsUrl) {
      response.openPaymentsUrl = `${openPaymentsUrl}/incoming-payments/${result.id}`;
    }

    return reply.status(201).send(response);
  });

  server.get<{ Params: { id: string } }>(
    '/payment-intents/:id',
    async (request, reply) => {
      const { id } = request.params;

      let paymentIntent;
      try {
        paymentIntent = await paymentsClient.getPaymentIntent(id);
      } catch (err) {
        if (err instanceof PaymentIntentNotFoundError) {
          return reply
            .status(404)
            .send({ error: `Payment intent '${id}' not found` });
        }
        throw err;
      }

      const response: {
        id: string;
        state: string;
        destination: string;
        walletAddress: string;
        incomingAmount?: {
          value: string;
          assetCode: string;
          assetScale: number;
        };
        receivedAmount: {
          value: string;
          assetCode: string;
          assetScale: number;
        };
        expiresAt?: string;
        destinationIlpAddress?: string;
      } = {
        id: paymentIntent.id,
        state: paymentIntent.state,
        destination: paymentIntent.destination,
        walletAddress: paymentIntent.receiverWalletAddress,
        receivedAmount: {
          value: String(paymentIntent.receivedAmount),
          assetCode: paymentIntent.assetCode,
          assetScale: paymentIntent.assetScale
        }
      };

      if (paymentIntent.incomingAmount != null) {
        response.incomingAmount = {
          value: String(paymentIntent.incomingAmount),
          assetCode: paymentIntent.assetCode,
          assetScale: paymentIntent.assetScale
        };
      }

      if (paymentIntent.expiresAt) {
        response.expiresAt = paymentIntent.expiresAt;
      }

      if (paymentIntent.destinationIlpAddress) {
        response.destinationIlpAddress = paymentIntent.destinationIlpAddress;
      }

      return reply.status(200).send(response);
    }
  );
}
