'use strict';

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  AuthClient,
  AuthClientGrantNotFoundError,
  AuthClientInvalidRotationError,
  AuthClientUnauthorizedRequestError,
  AuthClientUnknownAccessTokenError,
  RotateTokenResult
} from 'auth-client-lib';
import { OpenPaymentsAuthServerRouteError } from '../errors';
import { components } from '../types/generated/auth-server-types';
import {
  createAccessTokenResponse,
  decodeAccessTokenValue,
  decodeCompoundId
} from '../utils';
import {
  extractSignatureData,
  getGnapTokenOrThrow,
  requireSignatureHeaders
} from '../auth';

interface TokenRouteOptions extends FastifyPluginOptions {
  authClient: AuthClient;
  openPaymentsAuthServerUrl: string;
}

type RotateTokenResponse = {
  access_token: components['schemas']['access_token'];
};

export async function tokenRoutes(
  server: FastifyInstance,
  opts: TokenRouteOptions
): Promise<void> {
  const { authClient, openPaymentsAuthServerUrl } = opts;

  server.post<{
    Params: { id: string };
    Reply: RotateTokenResponse;
  }>(
    '/token/:id',
    {
      onRequest: async (request) => {
        requireSignatureHeaders(request);
        getGnapTokenOrThrow(request);
      }
    },
    async (request, reply) => {
      const { grantId, otherId: managementId } = decodeCompoundId(
        request.params.id
      );
      const tokenValue = decodeAccessTokenValue(request.gnapToken!, grantId);

      let result: RotateTokenResult;
      try {
        result = await authClient.rotateToken(
          grantId,
          extractSignatureData(request),
          tokenValue,
          managementId
        );
      } catch (err) {
        if (err instanceof AuthClientUnauthorizedRequestError) {
          throw new OpenPaymentsAuthServerRouteError(
            401,
            'invalid signature',
            'invalid_client'
          );
        }
        if (
          err instanceof AuthClientGrantNotFoundError ||
          err instanceof AuthClientUnknownAccessTokenError
        ) {
          throw new OpenPaymentsAuthServerRouteError(
            401,
            'invalid access token',
            'invalid_client'
          );
        }
        if (err instanceof AuthClientInvalidRotationError) {
          throw new OpenPaymentsAuthServerRouteError(
            404,
            'Could not rotate token',
            'invalid_rotation'
          );
        }
        throw err;
      }

      return reply.status(200).send({
        access_token: createAccessTokenResponse({
          grantId: result.grantId,
          accessTokenExpiresIn: result.newAccessTokenExpiresIn,
          accessTokenManagementId: result.newAccessTokenManagementId,
          accessTokenValue: result.newAccessTokenValue,
          access: result.access,
          openPaymentsAuthServerUrl
        })
      });
    }
  );

  server.delete<{
    Params: { id: string };
  }>(
    '/token/:id',
    {
      onRequest: async (request) => {
        requireSignatureHeaders(request);
        getGnapTokenOrThrow(request);
      }
    },
    async (request, reply) => {
      const { grantId, otherId: managementId } = decodeCompoundId(
        request.params.id
      );
      const tokenValue = decodeAccessTokenValue(request.gnapToken!, grantId);

      try {
        await authClient.revokeToken(
          grantId,
          extractSignatureData(request),
          tokenValue,
          managementId
        );
      } catch (err) {
        if (err instanceof AuthClientUnauthorizedRequestError) {
          throw new OpenPaymentsAuthServerRouteError(
            401,
            'invalid signature',
            'invalid_client'
          );
        }
        if (
          err instanceof AuthClientGrantNotFoundError ||
          err instanceof AuthClientUnknownAccessTokenError
        ) {
          throw new OpenPaymentsAuthServerRouteError(
            401,
            'invalid access token',
            'invalid_client'
          );
        }
        throw err;
      }

      return reply.status(204).send();
    }
  );
}
