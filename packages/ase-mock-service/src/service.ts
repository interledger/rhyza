import Fastify, {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from 'fastify';
import { NotificationType } from 'notifications-domain-lib';
import { PaymentCreatedPayload } from 'payments-domain-lib';
import { RATES } from './rates-data';

const HOST = process.env['HOST'] || '0.0.0.0';
const PORT = parseInt(process.env['PORT'] || '3000', 10);
const ADMIN_URL = process.env['ADMIN_URL'] || '127.0.0.1:3001';

const ACCEPT_RATES_ENDSWITH_MATCH =
  !!process.env['ACCEPT_RATES_ENDSWITH_MATCH'];

interface Webhook {
  id: string;
  type: NotificationType;
  data: Record<string, unknown>;
}

class WebhookServiceError extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

export class MockWebhookIntegrationService {
  private static server: FastifyInstance;
  public static async start() {
    this.server = Fastify({ logger: true });

    this.server.post<{ Body: Webhook }>('/webhooks', async (request, reply) => {
      try {
        console.log('Webhook received:', request.body);
        await this.handleWebhook(request.body);
        reply
          .code(200)
          .send('Webhook ' + request.body.type + ' processed successfully');
      } catch (err) {
        console.error(err);
        if (err instanceof WebhookServiceError) {
          reply.code(err.code).send(err.message);
        } else {
          reply.code(500).send('Internal server error');
        }
      }
    });

    // ASE Rates mock handler
    this.server.get('/rates', this.handleGetRates.bind(this));

    await this.server.listen({ host: HOST, port: PORT });
  }

  private static async handleWebhook(webhook: Webhook) {
    switch (webhook.type) {
      case NotificationType.PaymentCreated:
        await this.handlePaymentCreatedWebhook(webhook);
        break;
      case NotificationType.PaymentIntentCreated:
      case NotificationType.PaymentIntentCompleted:
      case NotificationType.PaymentCompleted:
      case NotificationType.PaymentFailed:
        break;
      default:
        console.warn(`Webhook type ${webhook.type} is not supported`);
        break;
    }
  }

  private static async handlePaymentCreatedWebhook(webhook: Webhook) {
    const payload = webhook.data as PaymentCreatedPayload;
    if (!webhook.id) {
      throw new WebhookServiceError('Created payment id is missing', 400);
    }
    if (!payload.paymentIntentId) {
      throw new WebhookServiceError('Payment intent id is missing', 400);
    }

    const response = await fetch(
      `${ADMIN_URL}/payment-intents/${payload.paymentIntentId}/payments/${payload.id}/approve`,
      {
        method: 'POST'
      }
    );
    if (!response.ok) {
      throw new WebhookServiceError('Failed to approve payment', 401);
    }
  }

  private static async handleGetRates(
    request: FastifyRequest<{ Querystring: { base: string; peerId?: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    const baseParam = request.query.base;
    const peerParam = request.query.peerId;

    if (!baseParam) {
      reply.status(400).send('Missing mandatory query parameter: "base"');
      return;
    }

    const rate = RATES.find(
      (r) =>
        ((ACCEPT_RATES_ENDSWITH_MATCH && baseParam.endsWith(r.base)) ||
          baseParam === r.base) &&
        (!peerParam ||
          (ACCEPT_RATES_ENDSWITH_MATCH &&
            r.peerId &&
            peerParam.endsWith(r.peerId)) ||
          peerParam === r.peerId)
    );
    if (!rate) {
      reply.status(404).send('Rate not found');
      return;
    }

    reply.send({
      base: baseParam,
      rates: rate.rates,
      mockedAt: new Date().toISOString()
    });
  }

  static async stop(): Promise<void> {
    await this.server?.close();
  }
}
