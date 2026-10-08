import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ErrorResponse, FxRateSet } from 'admin-client-lib';
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
    Body: FxRateSet;
    Reply: ErrorResponse | undefined;
  }>('/rates', async (request, reply) => {
    const {
      sourceAssetCode,
      destinationAssetCode,
      rate: fxRate,
      peerId,
      rateTtlSecs
    } = request.body;

    if (!sourceAssetCode || !destinationAssetCode || !fxRate || !rateTtlSecs) {
      return reply.status(400).send({
        error:
          'sourceAssetCode, destinationAssetCode, non-zero rate and non-zero rateTtlSecs are required'
      });
    }

    if (fxRate <= 0 || rateTtlSecs <= 0) {
      return reply.status(400).send({
        error: 'rate and rateTtlSecs must be greater than 0'
      });
    }

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
  });
}
