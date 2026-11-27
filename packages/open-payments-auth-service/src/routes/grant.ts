import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  AccessItem,
  AuthClient,
  AuthClientContinuationTooFastError,
  AuthClientGrantNotFoundError,
  AuthClientInvalidContinuationError,
  AuthClientInvalidGrantError,
  AuthClientInvalidGrantInputError,
  AuthClientInvalidInteractionError,
  AuthClientUnauthorizedRequestError,
  ContinueGrantResult,
  CreateGrantOptions,
  CreateGrantResult,
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

      let result: CreateGrantResult;
      try {
        result = await authClient.createGrant(
          resolveClientIdentifier(client),
          extractSignatureData(request),
          options
        );
      } catch (err) {
        if (err instanceof AuthClientUnauthorizedRequestError) {
          throw new OpenPaymentsAuthServerRouteError(
            401,
            'invalid signature',
            'invalid_client'
          );
        }
        if (err instanceof AuthClientInvalidGrantInputError) {
          throw new OpenPaymentsAuthServerRouteError(
            400,
            'invalid request',
            'invalid_request'
          );
        }
        throw err;
      }

      if (result.interactionNonce) {
        return reply.status(200).send({
          interact: createInteractResponse(
            result.id,
            result.interactionNonce,
            openPaymentsAuthServerUrl
          ),
          continue: createContinueResponse(
            result.id,
            result.continueId,
            result.continueToken,
            openPaymentsAuthServerUrl,
            result.continueWaitSeconds
          )
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
        continue: createContinueResponse(
          result.id,
          result.continueId,
          result.continueToken,
          openPaymentsAuthServerUrl
        )
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

      let result: ContinueGrantResult;
      try {
        result = await authClient.continueGrant(
          grantId,
          extractSignatureData(request),
          continueId,
          continueToken,
          request.body?.interact_ref
        );
      } catch (err) {
        if (err instanceof AuthClientUnauthorizedRequestError) {
          throw new OpenPaymentsAuthServerRouteError(
            401,
            'invalid signature',
            'invalid_client'
          );
        }
        if (err instanceof AuthClientGrantNotFoundError) {
          throw new OpenPaymentsAuthServerRouteError(
            404,
            'grant not found',
            'invalid_request'
          );
        }
        if (err instanceof AuthClientInvalidContinuationError) {
          throw new OpenPaymentsAuthServerRouteError(
            401,
            'invalid grant',
            'invalid_continuation'
          );
        }
        if (err instanceof AuthClientContinuationTooFastError) {
          throw new OpenPaymentsAuthServerRouteError(
            400,
            'continued grant faster than "wait" period',
            'too_fast'
          );
        }
        if (err instanceof AuthClientInvalidInteractionError) {
          throw new OpenPaymentsAuthServerRouteError(
            404,
            'grant not found',
            'invalid_continuation'
          );
        }
        if (err instanceof AuthClientInvalidGrantError) {
          throw new OpenPaymentsAuthServerRouteError(
            401,
            'grant cannot be continued',
            'request_denied'
          );
        }
        throw err;
      }

      if (
        !result.accessTokenValue ||
        !result.accessTokenManagementId ||
        !result.accessTokenExpiresIn
      ) {
        return reply.status(200).send({
          continue: createContinueResponse(
            result.id,
            result.continueId,
            result.continueToken,
            openPaymentsAuthServerUrl,
            result.continueWaitSeconds
          )
        });
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
        continue: createContinueResponse(
          result.id,
          result.continueId,
          result.continueToken,
          openPaymentsAuthServerUrl
        )
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

      try {
        await authClient.revokeGrant(
          grantId,
          extractSignatureData(request),
          continueId,
          continueToken
        );
      } catch (err) {
        if (err instanceof AuthClientUnauthorizedRequestError) {
          throw new OpenPaymentsAuthServerRouteError(
            401,
            'invalid signature',
            'invalid_client'
          );
        }
        if (err instanceof AuthClientGrantNotFoundError) {
          throw new OpenPaymentsAuthServerRouteError(
            404,
            'unknown grant',
            'invalid_request'
          );
        }
        if (err instanceof AuthClientInvalidContinuationError) {
          throw new OpenPaymentsAuthServerRouteError(
            401,
            'invalid grant',
            'invalid_continuation'
          );
        }
        if (err instanceof AuthClientInvalidGrantError) {
          throw new OpenPaymentsAuthServerRouteError(
            404,
            'invalid grant',
            'invalid_request'
          );
        }
        throw err;
      }

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
    type: item.type.toUpperCase().replaceAll('-', '_'), // domain expects UPPER_SNAKE_CASE
    actions: item.actions.map(
      (action) => action.toUpperCase().replaceAll('-', '_') // domain expects UPPER_SNAKE_CASE
    ),
    identifier: 'identifier' in item ? item.identifier : undefined,
    limits: 'limits' in item ? item.limits : undefined
  };
}
