import Fastify, { FastifyInstance } from 'fastify';
import {
  loadBase64Key,
  createHeaders
} from '@interledger/http-signature-utils';

const HOST = process.env['HOST'] || '0.0.0.0';
const PORT = parseInt(process.env['PORT'] || '3010', 10);

interface SignRequest {
  keyId: string;
  base64Key: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  };
}

function isValidBody(body: Partial<SignRequest>): body is SignRequest {
  return (
    !!body.keyId &&
    !!body.base64Key &&
    !!body.request?.headers &&
    !!body.request?.method &&
    !!body.request?.url
  );
}

export class HttpSignatureService {
  private static server: FastifyInstance;

  static async start(): Promise<void> {
    this.server = Fastify({ logger: true });

    this.server.post<{ Body: Partial<SignRequest> }>(
      '/',
      async (request, reply) => {
        if (!isValidBody(request.body)) {
          reply.status(400).send('Insufficient data in request body');
          return;
        }

        const { base64Key, keyId, request: signingRequest } = request.body;

        let privateKey;
        try {
          privateKey = loadBase64Key(base64Key);
        } catch {
          reply.status(400).send('Not a valid private key');
          return;
        }

        if (privateKey === undefined) {
          reply.status(400).send('Not an Ed25519 private key');
          return;
        }

        const headers = await createHeaders({
          request: signingRequest,
          privateKey,
          keyId
        });
        delete headers['Content-Length'];
        delete headers['Content-Type'];

        reply.status(200).send(headers);
      }
    );

    await this.server.listen({ host: HOST, port: PORT });
  }

  static async stop(): Promise<void> {
    await this.server?.close();
  }
}
