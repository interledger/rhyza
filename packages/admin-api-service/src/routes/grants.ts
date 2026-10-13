'use strict';

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  AuthClient,
  GetGrantResult,
  httpStatusFromGrpcError,
  toClientApiErrorResponse
} from 'auth-client-lib';
import {
  GetGrantRequest,
  JsonWebKey,
  instanceOfJsonWebKey
} from 'admin-client-lib';

interface GrantRouteOptions extends FastifyPluginOptions {
  authClient: AuthClient;
}

interface AdminApiGrant {
  id: string;
  state: GetGrantResult['state'];
  client: string | JsonWebKey;
  interactionNonce?: string;
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
    state: authClientGrant.state,
    client,
    interactionNonce: authClientGrant.interactionNonce,
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
    } catch (err) {
      server.log.error(err);
      const httpStatus = httpStatusFromGrpcError(err);
      const { error } = toClientApiErrorResponse(err);
      return reply.status(httpStatus).send({ error: error.description });
    }
  });
}
