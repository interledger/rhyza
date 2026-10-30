import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  AccessItem,
  AuthClient,
  CreateGrantOptions,
  SubjectId
} from 'auth-client-lib';
import { OpenPaymentsAuthServerRouteError } from '../errors';
import { components } from '../types/generated/auth-server-types';
import {
  createAccessTokenResponse,
  createContinueResponse,
  createInteractResponse,
  decodeCompoundId
} from '../utils';
import {
  extractSignatureData,
  getGnapTokenOrThrow,
  requireSignatureHeaders
} from '../auth';

interface GrantRouteOptions extends FastifyPluginOptions {
  authClient: AuthClient;
  openPaymentsAuthServerUrl: string;
}

type ClientSchema = components['schemas']['client'];

type CreateGrantSuccessResponse =
  | {
      interact: components['schemas']['interact-response'];
      continue: components['schemas']['continue'];
    }
  | {
      access_token: components['schemas']['access_token'];
      continue: components['schemas']['continue'];
    };

type ContinueGrantSuccessResponse = {
  access_token?: components['schemas']['access_token'];
  continue: components['schemas']['continue'];
};

export async function grantRoutes(
  server: FastifyInstance,
  opts: GrantRouteOptions
): Promise<void> {
  const { authClient, openPaymentsAuthServerUrl } = opts;

  server.post<{
    Body: components['schemas']['grant-request'];
    Reply: CreateGrantSuccessResponse;
  }>(
    '/',
    {
      onRequest: async (request) => {
        requireSignatureHeaders(request);
      },
      schema: {
        body: { $ref: '#/components/schemas/grant-request#' }
      }
    },
    async (request, reply) => {
      const { client, interact, subject } = request.body;
      const access =
        'access_token' in request.body && request.body.access_token
          ? request.body.access_token.access.map(toAccessItem)
          : undefined;
      const subjectIds: SubjectId[] | undefined = subject?.sub_ids;

      if (!access?.length && !subjectIds?.length) {
        throw new OpenPaymentsAuthServerRouteError(
          400,
          'Request must include access_token or subject',
          'invalid_request'
        );
      }

      const finish = interact?.finish
        ? {
            method: interact.finish.method,
            uri: interact.finish.uri,
            nonce: interact.finish.nonce
          }
        : undefined;

      const options: CreateGrantOptions = access?.length
        ? { access, subjectIds, finish, start: interact?.start || [] }
        : {
            subjectIds: subjectIds ?? [],
            finish,
            start: interact?.start || []
          };

      const result = await authClient.createGrant(
        resolveClientIdentifier(client),
        extractSignatureData(request),
        options
      );

      const continueResponse = createContinueResponse(
        result.id,
        result.continueId,
        result.continueToken,
        openPaymentsAuthServerUrl
      );

      if (result.interactionNonce) {
        return reply.status(200).send({
          interact: createInteractResponse(
            result.id,
            result.interactionNonce,
            openPaymentsAuthServerUrl
          ),
          continue: continueResponse
        });
      }

      if (
        !result.accessTokenExpiresIn ||
        !result.accessTokenValue ||
        !result.accessTokenManagementId
      ) {
        throw new OpenPaymentsAuthServerRouteError(
          500,
          'Could not generate access token for grant request',
          'request_denied'
        );
      }

      return reply.status(200).send({
        access_token: createAccessTokenResponse({
          grantId: result.id,
          accessTokenExpiresIn: result.accessTokenExpiresIn,
          accessTokenManagementId: result.accessTokenManagementId,
          accessTokenValue: result.accessTokenValue,
          access: result.access,
          openPaymentsAuthServerUrl
        }),
        continue: continueResponse
      });
    }
  );

  server.post<{
    Params: { id: string };
    Body: components['schemas']['continuation-request'] | undefined;
    Reply: ContinueGrantSuccessResponse;
  }>(
    '/continue/:id',
    {
      onRequest: async (request) => {
        requireSignatureHeaders(request);
        getGnapTokenOrThrow(request);
      },
      schema: {
        // The body is optional, e.g. when polling. Fastify validates a missing body as null.
        body: {
          anyOf: [
            { $ref: '#/components/schemas/continuation-request#' },
            { type: 'null' }
          ]
        }
      }
    },
    async (request, reply) => {
      const continueToken = request.gnapToken!;

      const { grantId, otherId: continueId } = decodeCompoundId(
        request.params.id
      );

      const result = await authClient.continueGrant(
        grantId,
        extractSignatureData(request),
        continueId,
        continueToken,
        request.body?.interact_ref
      );

      const continueResponse = createContinueResponse(
        result.id,
        result.continueId,
        result.continueToken,
        openPaymentsAuthServerUrl
      );

      if (
        !result.accessTokenValue ||
        !result.accessTokenManagementId ||
        !result.accessTokenExpiresIn
      ) {
        return reply.status(200).send({ continue: continueResponse });
      }

      return reply.status(200).send({
        access_token: createAccessTokenResponse({
          grantId: result.id,
          accessTokenExpiresIn: result.accessTokenExpiresIn,
          accessTokenManagementId: result.accessTokenManagementId,
          accessTokenValue: result.accessTokenValue,
          access: result.access,
          openPaymentsAuthServerUrl
        }),
        continue: continueResponse
      });
    }
  );

  server.delete<{
    Params: { id: string };
  }>(
    '/continue/:id',
    {
      onRequest: async (request) => {
        requireSignatureHeaders(request);
        getGnapTokenOrThrow(request);
      }
    },
    async (request, reply) => {
      const continueToken = request.gnapToken!;

      const { grantId, otherId: continueId } = decodeCompoundId(
        request.params.id
      );

      await authClient.revokeGrant(
        grantId,
        extractSignatureData(request),
        continueId,
        continueToken
      );

      return reply.status(204).send();
    }
  );
}

function resolveClientIdentifier(client: ClientSchema): string {
  if (typeof client === 'string') {
    return client;
  }
  if ('walletAddress' in client) {
    return client.walletAddress;
  }
  return JSON.stringify(client.jwk);
}

function toAccessItem(item: components['schemas']['access-item']): AccessItem {
  return {
    type: item.type.toUpperCase().replace('-', '_'), // domain expects UPPER_SNAKE_CASE
    actions: item.actions.map(
      (action) => action.toUpperCase().replace('-', '_') // domain expects UPPER_SNAKE_CASE
    ),
    identifier: 'identifier' in item ? item.identifier : undefined,
    limits: 'limits' in item ? item.limits : undefined
  };
}
