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
    Reply: components['schemas']['wallet-address'];
  }>('/:walletAddressPath', async (request, reply) => {
    const { walletAddressPath } = request.params;

    const alias = await opts.palClient.ResolveWalletAddressAlias(
      null,
      walletAddressPath
    );

    if (!alias) {
      throw new OpenPaymentsResourceServerRouteError(
        404,
        'Wallet address not found',
        'not_found'
      );
    }

    const walletAddresses = await opts.palClient.getWalletAddresses([
      alias.walletAddressId
    ]);

    if (!walletAddresses.length) {
      throw new OpenPaymentsResourceServerRouteError(
        404,
        'Wallet address not found',
        'not_found'
      );
    }

    const walletAddress = walletAddresses[0];

    return reply.status(200).send({
      id: `${opts.openPaymentsResourceServiceUrl}/${alias.pathName}`,
      publicName: walletAddress.publicName,
      assetCode: walletAddress.assetCode,
      assetScale: walletAddress.assetScale,
      resourceServer: opts.openPaymentsResourceServiceUrl,
      authServer: opts.openPaymentsAuthServiceUrl
    });
  });
}
