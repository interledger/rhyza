import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { AuthClient } from 'auth-client-lib';
import { calculateInteractionHash } from '../utils';

interface InteractionRouteOptions extends FastifyPluginOptions {
  authClient: AuthClient;
  openPaymentsAuthServerUrl: string;
}

// TODO: validate that this is set on startup
const IDP_URL = process.env['IDP_URL'];

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
    const { id, nonce, clientUri, clientName } =
      await authClient.startInteraction(grantId);

    request.session.interactionSessionId = nonce;

    const redirectUrl = new URL(IDP_URL as string);
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
    const grant = await authClient.getGrant(grantId);
    if (!grant) return reply.status(404).send();
    if (request.session.interactionSessionId !== grant.interactionNonce) {
      return reply.status(401).send();
    }
    const result = await authClient.finishInteraction(
      grantId,
      grant.interactionNonce
    );

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
