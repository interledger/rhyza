'use strict';

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PalClient } from 'pal-client-lib';
import crypto from 'crypto';
import { LiquidityDepositRequest } from 'admin-client-lib';

interface LiquidityRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
}

export async function liquidityRoutes(
  server: FastifyInstance,
  opts: LiquidityRouteOptions
): Promise<void> {
  const { palClient } = opts;

  server.post<{
    Body: LiquidityDepositRequest;
  }>('/liquidity/deposit', async (request, reply) => {
    const { assetCode, peerId, amount, amountScale } = request.body;

    const requestId = crypto.randomUUID();

    await palClient.ledgerDepositToAse({
      requestId: requestId,
      peerId: peerId,
      amount: amount.toString(),
      assetCode: assetCode,
      amountScale: amountScale
    });

    return reply.status(200).send({ id: requestId });
  });
}
