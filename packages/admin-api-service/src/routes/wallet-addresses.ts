'use strict';

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PalClient } from 'pal-client-lib';

interface WalletAddressRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
}

export async function walletAddressRoutes(
  server: FastifyInstance,
  opts: WalletAddressRouteOptions
): Promise<void> {
  const { palClient } = opts;

  server.post<{
    Body: {
      address: string;
      publicName: string;
      assetCode: string;
      isActive?: boolean;
    };
  }>('/wallet-addresses', async (request, reply) => {
    const { address, publicName, assetCode, isActive } = request.body;

    const { domain, pathName } = parserAddressToDomainAndPathName(address);

    let result;
    try {
      result = await palClient.createWalletAddress(
        domain,
        pathName,
        publicName,
        assetCode,
        isActive
      );
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

    return reply.status(201).send({
      address: result.domain ?  `${result.domain}/${result.pathName}` : result.pathName
    });
  });
}


function parserAddressToDomainAndPathName(address: string): { domain: string | null, pathName: string} {
  let toParseAddress = address.includes('://') ? address  : 'http://' + address;

  try{
    const url = new URL(toParseAddress);
    return {
      domain: url.hostname,
      pathName: url.pathname.startsWith('/') ? url.pathname.substring(1) : url.pathname
    }
  }catch(err){
    // not url, must be all pathname
    return {domain: null, pathName: address};
  }

}
