import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  AuthClient,
  AuthClientGrantNotFoundError,
  AuthClientInvalidGrantError,
  AuthClientInvalidInteractionError,
  AuthClientUnknownInteractionError,
  FinishInteractionResult,
  StartInteractionResult
} from 'auth-client-lib';
import { OpenPaymentsAuthServerRouteError } from '../errors';
import { calculateInteractionHash } from '../utils';

interface InteractionRouteOptions extends FastifyPluginOptions {
  authClient: AuthClient;
  openPaymentsAuthServerUrl: string;
  idpUrl: string;
}

export async function interactionRoutes(
  server: FastifyInstance,
  opts: InteractionRouteOptions
): Promise<void> {
  server.get<{
    Params: { grantId: string };
    session: { authenticated: boolean };
  }>('/interaction/:grantId/start', async (request, reply) => {
    const { authClient } = opts;
    const { grantId } = request.params;
    let interaction: StartInteractionResult;
    try {
      interaction = await authClient.startInteraction(grantId);
    } catch (err) {
      if (err instanceof AuthClientGrantNotFoundError) {
        throw new OpenPaymentsAuthServerRouteError(
          400,
          'unknown interaction',
          'unknown_interaction'
        );
      }
      if (
        err instanceof AuthClientInvalidInteractionError ||
        err instanceof AuthClientInvalidGrantError
      ) {
        throw new OpenPaymentsAuthServerRouteError(
          403,
          'invalid interaction',
          'invalid_interaction'
        );
      }
      throw err;
    }
    const { id, nonce, clientUri, clientName } = interaction;

    request.session.interactionSessionId = nonce;

    const redirectUrl = new URL(opts.idpUrl);
    redirectUrl.searchParams.set('interactId', id);
    redirectUrl.searchParams.set('clientName', clientName);
    redirectUrl.searchParams.set('clientUri', clientUri);
    return reply.redirect(redirectUrl.toString());
  });

  server.post<{
    Params: { grantId: string };
  }>('/interaction/:grantId/finish', async (request, reply) => {
    const { authClient } = opts;
    const { grantId } = request.params;
    // no stored session (never started, or expired from the store)
    if (!request.session.interactionSessionId) {
      return reply.status(401).send();
    }
    const grant = await authClient.getGrant(grantId);
    if (!grant) return reply.status(404).send();
    if (request.session.interactionSessionId !== grant.interactionNonce) {
      return reply.status(401).send();
    }
    let result: FinishInteractionResult;
    try {
      result = await authClient.finishInteraction(
        grantId,
        grant.interactionNonce
      );
    } catch (err) {
      // Status codes follow Rafiki: 404 for an unknown interaction and 401
      // for an invalid one on finish.
      if (
        err instanceof AuthClientGrantNotFoundError ||
        err instanceof AuthClientUnknownInteractionError
      ) {
        throw new OpenPaymentsAuthServerRouteError(
          404,
          'unknown interaction',
          'unknown_interaction'
        );
      }
      if (
        err instanceof AuthClientInvalidInteractionError ||
        err instanceof AuthClientInvalidGrantError
      ) {
        throw new OpenPaymentsAuthServerRouteError(
          401,
          'interaction is not active',
          'invalid_interaction'
        );
      }
      throw err;
    }

    if (result.finishUri) {
      const interactionHash = calculateInteractionHash(
        result.clientNonce,
        result.interactNonce,
        result.interactRef,
        opts.openPaymentsAuthServerUrl
      );

      const redirectUrl = new URL(result.finishUri);
      redirectUrl.searchParams.set('hash', interactionHash);
      redirectUrl.searchParams.set('interact_ref', result.interactRef);

      return reply.redirect(redirectUrl.toString());
    } else {
      return reply.status(202).send();
    }
  });
}
