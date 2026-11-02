'use strict';

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PalClient } from 'pal-client-lib';
import { OpenPaymentsResourceServerRouteError } from '../errors';
import { components } from '../types/generated/wallet-address-server-types';

interface WalletAddressRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
  openPaymentsResourceServiceUrl: string;
  openPaymentsAuthServiceUrl: string;
}

export async function walletAddressRoutes(
  server: FastifyInstance,
  opts: WalletAddressRouteOptions
): Promise<void> {
  server.get<{
    Params: { walletAddressPath: string };
    Reply: components['schemas']['json-web-key-set'];
  }>('/:walletAddressPath/jwks.json', async (request, reply) => {
    const { walletAddressPath } = request.params;

    const walletAddress = await opts.palClient.resolveWalletAddressByAlias(
      null,
      walletAddressPath
    );

    if (!walletAddress) {
      throw new OpenPaymentsResourceServerRouteError(
        404,
        'Wallet address not found',
        'not_found'
      );
    }

    const storedKeys = await opts.palClient.getWalletAddressKeys(
      walletAddress.id
    );

    return reply.status(200).send({
      keys: storedKeys
        .filter((key) => !key.revoked)
        .map((key) => ({
          kid: key.jwk.kid,
          alg: 'EdDSA' as const,
          kty: 'OKP' as const,
          crv: 'Ed25519' as const,
          x: key.jwk.x,
          ...(key.jwk.use === 'sig' ? { use: 'sig' as const } : {})
        }))
    });
  });

  server.get<{
    Params: { walletAddressPath: string };
    Reply: components['schemas']['wallet-address'];
  }>('/:walletAddressPath', async (request, reply) => {
    const { walletAddressPath } = request.params;

    const walletAddress = await opts.palClient.resolveWalletAddressByAlias(
      null,
      walletAddressPath
    );

    if (!walletAddress || !walletAddress.isActive) {
      throw new OpenPaymentsResourceServerRouteError(
        404,
        'Wallet address not found',
        'not_found'
      );
    }

    return reply.status(200).send({
      id: `${opts.openPaymentsResourceServiceUrl}/${walletAddressPath}`,
      publicName: walletAddress.publicName,
      assetCode: walletAddress.assetCode,
      assetScale: walletAddress.assetScale,
      resourceServer: opts.openPaymentsResourceServiceUrl,
      authServer: opts.openPaymentsAuthServiceUrl
    });
  });
}
