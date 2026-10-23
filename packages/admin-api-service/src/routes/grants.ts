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
  GrantsListGrantsRequest,
  JsonWebKey,
  instanceOfJsonWebKey
} from 'admin-client-lib';
import { parseGrantPageQuery } from '../pagination.js';

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

  server.get<{ Querystring: GrantsListGrantsRequest }>(
    '/grants',
    async (request, reply) => {
      try {
        const page = await authClient.getGrantsPage(
          parseGrantPageQuery(request.query)
        );

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
        return reply.status(404);
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
