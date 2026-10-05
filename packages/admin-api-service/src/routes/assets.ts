'use strict';

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PalClient } from 'pal-client-lib';
import { AssetCreate } from 'admin-client-lib';

interface AssetRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
}

export async function assetRoutes(
  server: FastifyInstance,
  opts: AssetRouteOptions
): Promise<void> {
  const { palClient } = opts;

  server.post<{
    Body: AssetCreate;
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

  server.get<{
    Querystring: { codes: string[] };
  }>('/assets', async (request, reply) => {
    const { codes } = request.query;
    const assetCodes = codes.filter((code): code is string => Boolean(code));

    try {
      const assets = await palClient.getAssets(assetCodes);
      if (assets.length === 0) {
        return reply.status(404).send({ error: 'Assets not found' });
      }
      return reply.status(200).send({ assets });
    } catch (err) {
      throw err;
    }
  });
}
