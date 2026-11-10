'use strict';

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  AuthClient,
  GetGrantResult,
  httpStatusFromClientError,
  isAuthClientError
} from 'auth-client-lib';
import {
  GetGrantRequest,
  JsonWebKey,
  instanceOfJsonWebKey
} from 'admin-client-lib';
import {
  GrantPageQuery,
  MAX_GRANT_WALLET_ADDRESSES,
  parseGrantPageQuery
} from '../pagination.js';

interface GrantRouteOptions extends FastifyPluginOptions {
  authClient: AuthClient;
}

interface AdminApiGrant {
  id: string;
  createdAt: string;
  state: GetGrantResult['state'];
  client: string | JsonWebKey;
  subjectIds?: GetGrantResult['subjectIds'];
  accesses?: GetGrantResult['accesses'];
  interaction?: GetGrantResult['interaction'];
}

function toAdminApiGrant(authClientGrant: GetGrantResult): AdminApiGrant {
  let client: string | JsonWebKey = authClientGrant.client;
  try {
    const maybeJsonWebKey = JSON.parse(client);
    if (instanceOfJsonWebKey(maybeJsonWebKey)) client = maybeJsonWebKey;
  } catch {
    // Just pass plain string if invalid object.
  }
  return {
    id: authClientGrant.id,
    createdAt: authClientGrant.createdAt,
    state: authClientGrant.state,
    client,
    subjectIds: authClientGrant.subjectIds,
    accesses: authClientGrant.accesses,
    interaction: authClientGrant.interaction
  };
}

export async function grantRoutes(
  server: FastifyInstance,
  opts: GrantRouteOptions
): Promise<void> {
  const { authClient } = opts;

  server.get<{ Querystring: GrantPageQuery }>(
    '/grants',
    async (request, reply) => {
      const query = parseGrantPageQuery(request.query);

      if (query.identifiers.length > MAX_GRANT_WALLET_ADDRESSES) {
        return reply.status(400).send({
          error: `Too many walletAddress filters: ${query.identifiers.length}, maximum is ${MAX_GRANT_WALLET_ADDRESSES}`
        });
      }

      try {
        const page = await authClient.getGrantsPage(query);

        return reply.status(200).send({
          result: page.items.map((grant) => toAdminApiGrant(grant)),
          pagination: page.pagination
        });
      } catch (error) {
        server.log.error(error);
        const httpStatus = httpStatusFromClientError(error);
        return reply
          .status(httpStatus)
          .send(
            isAuthClientError(error) ? { error: error.message } : { error }
          );
      }
    }
  );

  server.get<{
    Params: GetGrantRequest;
  }>('/grants/:id', async (request, reply) => {
    const { id } = request.params;

    try {
      const grant = await authClient.getGrant(id);
      if (!grant) {
        return reply.status(404).send({ error: 'Grant not found' });
      }
      return reply.status(200).send(toAdminApiGrant(grant));
    } catch (error) {
      server.log.error(error);
      const httpStatus = httpStatusFromClientError(error);
      return reply
        .status(httpStatus)
        .send(isAuthClientError(error) ? { error: error.message } : { error });
    }
  });

  server.post<{
    Params: {
      id: string;
    };
  }>('/grants/:id/revoke', async (request, reply) => {
    const { id } = request.params;

    try {
      const result = await authClient.adminRevokeGrant(id);

      return reply.status(200).send(result);
    } catch (error) {
      server.log.error(error);
      const httpStatus = httpStatusFromClientError(error);
      return reply
        .status(httpStatus)
        .send(isAuthClientError(error) ? { error: error.message } : { error });
    }
  });
}
