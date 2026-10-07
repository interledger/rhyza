'use strict';

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  PalClient,
  PalClientDuplicateWalletAddressKeyError,
  PalClientInvalidWalletAddressJwkError,
  PalClientWalletAddressKeyAlreadyRevokedError,
  PalClientWalletAddressKeyNotFoundError,
  PalClientWalletAddressAlreadyActiveError,
  PalClientWalletAddressAlreadyInactiveError,
  PalClientWalletAddressNotFoundError,
  parseAddressToDomainAndPathName
} from 'pal-client-lib';
import { JsonWebKey, WalletAddressCreate } from 'admin-client-lib';

interface WalletAddressRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
}

export async function walletAddressRoutes(
  server: FastifyInstance,
  opts: WalletAddressRouteOptions
): Promise<void> {
  const { palClient } = opts;

  server.post<{
    Body: WalletAddressCreate;
  }>('/wallet-addresses', async (request, reply) => {
    const { address, publicName, assetCode, isActive } = request.body;

    const { domain, pathName } = parseAddressToDomainAndPathName(address);

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
      id: result.id,
      address: result.domain
        ? `${result.domain}/${result.pathName}`
        : result.pathName
    });
  });

  server.post<{
    Params: { id: string };
  }>('/wallet-addresses/:id/activate', async (request, reply) => {
    try {
      await palClient.activateWalletAddress(request.params.id);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof PalClientWalletAddressNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (err instanceof PalClientWalletAddressAlreadyActiveError) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
  });

  server.post<{
    Params: { id: string };
  }>('/wallet-addresses/:id/deactivate', async (request, reply) => {
    try {
      await palClient.deactivateWalletAddress(request.params.id);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof PalClientWalletAddressNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (err instanceof PalClientWalletAddressAlreadyInactiveError) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
  });

  server.post<{
    Params: { id: string };
    Body: JsonWebKey;
  }>('/wallet-addresses/:id/keys', async (request, reply) => {
    try {
      const id = await palClient.addWalletAddressKey(
        request.params.id,
        request.body
      );
      return reply.status(201).send({ id });
    } catch (err) {
      if (err instanceof PalClientWalletAddressNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (err instanceof PalClientInvalidWalletAddressJwkError) {
        return reply.status(400).send({ error: err.message });
      }
      if (err instanceof PalClientDuplicateWalletAddressKeyError) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
  });

  server.post<{
    Params: { id: string; keyId: string };
  }>('/wallet-addresses/:id/keys/:keyId/revoke', async (request, reply) => {
    try {
      await palClient.revokeWalletAddressKey(
        request.params.id,
        request.params.keyId
      );
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof PalClientWalletAddressKeyNotFoundError) {
        return reply.status(404).send({ error: err.message });
      }
      if (err instanceof PalClientWalletAddressKeyAlreadyRevokedError) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
  });
}
