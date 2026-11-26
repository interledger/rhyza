import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { components } from '../types/generated/admin-api-types.js';

import { PalClient } from 'pal-client-lib';

interface RateRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
}

export async function ratesRoutes(
  server: FastifyInstance,
  opts: RateRouteOptions
): Promise<void> {
  const { palClient } = opts;
  server.post<{
    Body: components['schemas']['FxRateSet'];
    Reply: components['schemas']['ErrorResponse'] | undefined;
  }>(
    '/rates',
    {
      schema: { body: { $ref: '#/components/schemas/FxRateSet#' } }
    },
    async (request, reply) => {
      const {
        sourceAssetCode,
        destinationAssetCode,
        rate: fxRate,
        peerId,
        rateTtlSecs
      } = request.body;

      try {
        await palClient.setFxRate(
          sourceAssetCode,
          destinationAssetCode,
          fxRate,
          peerId,
          rateTtlSecs
        );
      } catch {
        return reply.status(500).send({ error: 'Failed to set FX rate' });
      }

      return reply.status(204).send();
    }
  );
}
