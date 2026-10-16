'use strict';

import { AuthClient } from 'auth-client-lib';
import { GrantsListGrantsRequest } from 'admin-client-lib';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
// generic grpc -> http mappers; they live in payments-client-lib but are not
// payments-specific
import {
  httpStatusFromGrpcError,
  toClientApiErrorResponse
} from 'payments-client-lib';
import { parseGrantPageQuery } from '../pagination.js';

interface GrantRouteOptions extends FastifyPluginOptions {
  authClient: AuthClient;
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
          result: page.items.map(toGrantBody),
          pagination: page.pagination
        });
      } catch (err) {
        server.log.error(err);
        const httpStatus = httpStatusFromGrpcError(err);
        const { error } = toClientApiErrorResponse(err);
        return reply.status(httpStatus).send({ error: error.description });
      }
    }
  );
}

/**
 * Projects a grant for the Admin API. Omits the grant's secrets — continue
 * token, interaction and finish nonces, access tokens — which an operator
 * listing has no use for.
 */
function toGrantBody(grant: {
  id: string;
  createdAt: string;
  state: string;
  client: string;
  accesses: {
    type: string;
    actions: string[];
    identifier?: string;
    limits?: unknown;
  }[];
  subjectIds: { format: string; id: string }[];
}) {
  return {
    id: grant.id,
    createdAt: grant.createdAt,
    state: grant.state,
    ...(grant.client ? { client: grant.client } : {}),
    accesses: grant.accesses,
    subjectIds: grant.subjectIds
  };
}
