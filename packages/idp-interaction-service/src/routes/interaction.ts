import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { AuthClient } from 'auth-client-lib';
import { verifyIdpSecret } from '../auth';

interface InteractionRouteOptions extends FastifyPluginOptions {
  authClient: AuthClient;
}

export async function interactionRoutes(
  server: FastifyInstance,
  opts: InteractionRouteOptions
): Promise<void> {
  const { authClient } = opts;

  server.get<{
    Params: { id: string };
  }>(
    '/grant/:id',
    {
      onRequest: async (request, reply) => {
        verifyIdpSecret(request, reply);
      }
    },
    async (request, reply) => {
      const { id } = request.params;

      const grant = await authClient.getGrant(id);

      if (!grant) {
        return reply.status(404).send();
      }

      return reply.status(200).send({
        id: grant.id,
        access: grant.accesses,
        subject: grant.subjectIds
          ? {
              sub_ids: grant.subjectIds
            }
          : undefined,
        state: grant.state
      });
    }
  );

  server.post<{
    Params: { grantId: string };
  }>(
    '/interaction/:grantId/accept',
    {
      onRequest: async (request, reply) => {
        verifyIdpSecret(request, reply);
      }
    },
    async (request, reply) => {
      const { grantId } = request.params;

      await authClient.acceptInteraction(grantId);

      return reply.status(202).send();
    }
  );

  server.post<{
    Params: { grantId: string };
  }>(
    '/interaction/:grantId/reject',
    {
      onRequest: async (request, reply) => {
        verifyIdpSecret(request, reply);
      }
    },
    async (request, reply) => {
      const { grantId } = request.params;

      await authClient.rejectInteraction(grantId);

      return reply.status(202).send();
    }
  );
}
