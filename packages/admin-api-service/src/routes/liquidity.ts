'use strict';

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PalClient } from 'pal-client-lib';
import crypto from 'crypto';
import type { components } from '../types/generated/admin-api-types.js';

interface LiquidityRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
}

export async function liquidityRoutes(
  server: FastifyInstance,
  opts: LiquidityRouteOptions
): Promise<void> {
  const { palClient } = opts;

  server.post<{
    Body: components['schemas']['LiquidityDeposit'];
  }>(
    '/liquidity/deposit',
    {
      schema: { body: { $ref: '#/components/schemas/LiquidityDeposit#' } }
    },
    async (request, reply) => {
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
    }
  );
}
