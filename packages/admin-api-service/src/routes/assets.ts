'use strict';

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PalClient } from 'pal-client-lib';

interface AssetRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
}

export async function assetRoutes(
  server: FastifyInstance,
  opts: AssetRouteOptions
): Promise<void> {
  const { palClient } = opts;

  server.post<{
    Body: {
      code: string;
      scale: number;
    };
  }>('/assets', async (request, reply) => {
    const { code, scale } = request.body;

    try {
      await palClient.createAsset(code, scale);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      // TODO: PAL service returns gRPC code 2 (UNKNOWN) for duplicates — should probably
      // be code 6 (ALREADY_EXISTS) so we can check err.code instead of string matching.
      if (
        err.message?.includes('already exists') ||
        err.details?.includes('already exists')
      ) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    }

    return reply.status(201).send({ code });
  });
}
