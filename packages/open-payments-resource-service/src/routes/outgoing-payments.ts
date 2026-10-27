'use strict';

import { randomUUID } from 'crypto';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PalClient, pathNameFromWalletAddress } from 'pal-client-lib';
import {
  httpStatusFromGrpcError,
  toClientApiErrorResponse,
  IAmount,
  PaymentsClient,
  IPayment
} from 'payments-client-lib';
import { OpenPaymentsResourceServerRouteError } from '../errors.js';
import { components } from '../types/generated/resource-server-types.js';
import { decodeCompoundId, encodeCompoundId } from '../utils.js';

interface OutgoingPaymentRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
  paymentsClient: PaymentsClient;
  /** Base URL of this instance's Open Payments resource server, used to construct receiver URLs for LOCAL parents. */
  openPaymentsUrl: string;
}

function toAmountBody(amount: IAmount): components['schemas']['amount'] {
  return {
    value: String(amount.value),
    assetCode: amount.assetCode,
    assetScale: amount.assetScale
  };
}

/**
 * A payment created without a quote has no `receiveAmount`. Should not be
 * possible via open payments creation but must be handled none-the-less.
 *
 * TODO: Change Open Payments spec to make receiveAmount nullable.
 */
function toOutgoingPaymentBody(
  payment: IPayment,
  openPaymentsUrl: string
): Omit<components['schemas']['outgoing-payment'], 'receiveAmount'> & {
  receiveAmount: components['schemas']['amount'] | null;
} {
  // REMOTE parents carry the peer's incoming payment URL; for LOCAL
  // parents the receiver is this instance's own incoming payment resource.
  const receiver =
    payment.remotePaymentIntentUrl ??
    `${openPaymentsUrl}/incoming-payments/${payment.paymentIntentId}`;

  return {
    id: `${openPaymentsUrl}/outgoing-payments/${encodeCompoundId(payment.paymentIntentId, payment.id)}`,
    walletAddress: payment.senderWalletAddress,
    receiver,
    failed: payment.state === 'FAILED',
    ...(payment.quoteId
      ? {
          quoteId: `${openPaymentsUrl}/quotes/${encodeCompoundId(payment.paymentIntentId, payment.quoteId)}`
        }
      : {}),
    debitAmount: toAmountBody(payment.debitAmount),
    receiveAmount:
      payment.receiveAmount === null
        ? null
        : toAmountBody(payment.receiveAmount),
    sentAmount: toAmountBody(payment.sentAmount),
    createdAt: payment.createdAt,
    ...(payment.metadata ? { metadata: payment.metadata } : {})
  };
}

export async function outgoingPaymentRoutes(
  server: FastifyInstance,
  opts: OutgoingPaymentRouteOptions
): Promise<void> {
  const { palClient, paymentsClient, openPaymentsUrl } = opts;

  server.post<{
    Body: components['schemas']['create-outgoing-payment-request'];
  }>(
    '/outgoing-payments',
    {
      schema: {
        body: { $ref: '#/components/schemas/create-outgoing-payment-request#' }
      }
    },
    async (request, reply) => {
      const { walletAddress: walletAddressUrl } = request.body;

      const pathName = pathNameFromWalletAddress(walletAddressUrl);

      const walletAddress = await palClient.resolveWalletAddressByAlias(
        null,
        pathName
      );

      if (!walletAddress) {
        throw new OpenPaymentsResourceServerRouteError(
          404,
          'Wallet address not found',
          'not_found'
        );
      }

      if (
        'debitAmount' in request.body &&
        (request.body.debitAmount.assetCode !== walletAddress.assetCode ||
          request.body.debitAmount.assetScale !== walletAddress.assetScale)
      ) {
        throw new OpenPaymentsResourceServerRouteError(
          400,
          'debitAmount asset does not match wallet address asset',
          'invalid_request'
        );
      }

      // Decoded outside the try/catch so a decode error is handled
      // as a route error, not a gRPC error.
      const quoteSource =
        'quoteId' in request.body
          ? ({
              kind: 'existing',
              ...decodeCompoundId(request.body.quoteId)
            } as const)
          : ({
              kind: 'create',
              incomingPaymentUrl: request.body.incomingPayment,
              debitAmountValue: Number(request.body.debitAmount.value)
            } as const);

      try {
        // Open Payments requires a receiveAmount on the created outgoing payment, but
        // we will not have one if it is created without a quote (only debit amount).
        // A quote is created here as a workaround.
        const quote =
          quoteSource.kind === 'existing'
            ? {
                paymentIntentId: quoteSource.paymentIntentId,
                id: quoteSource.resourceId
              }
            : await paymentsClient.createQuote(
                randomUUID(),
                { paymentIntentUrl: quoteSource.incomingPaymentUrl },
                walletAddress.id,
                walletAddressUrl,
                quoteSource.debitAmountValue
              );

        const { payment } = await paymentsClient.createPayment(
          randomUUID(),
          { paymentIntentId: quote.paymentIntentId },
          walletAddress.id,
          walletAddressUrl,
          quote.id
        );

        return reply
          .status(201)
          .send(toOutgoingPaymentBody(payment, openPaymentsUrl));
      } catch (err) {
        const httpStatus = httpStatusFromGrpcError(err);
        return reply.status(httpStatus).send(toClientApiErrorResponse(err));
      }
    }
  );

  server.get<{ Params: { id: string } }>(
    '/outgoing-payments/:id',
    async (request, reply) => {
      const { paymentIntentId, resourceId: paymentId } = decodeCompoundId(
        request.params.id
      );

      try {
        const payment = await paymentsClient.getPayment(
          paymentIntentId,
          paymentId
        );

        return reply
          .status(200)
          .send(toOutgoingPaymentBody(payment, openPaymentsUrl));
      } catch (err) {
        const httpStatus = httpStatusFromGrpcError(err);
        return reply.status(httpStatus).send(toClientApiErrorResponse(err));
      }
    }
  );

  server.get<{
    Querystring: {
      'wallet-address': string;
      cursor?: string;
      first?: string;
      last?: string;
    };
  }>('/outgoing-payments', async (request, reply) => {
    const walletAddressUrl = request.query['wallet-address'];

    if (!walletAddressUrl) {
      throw new OpenPaymentsResourceServerRouteError(
        400,
        "Missing required query parameter 'wallet-address'",
        'invalid_request'
      );
    }

    const pathName = pathNameFromWalletAddress(walletAddressUrl);

    const walletAddress = await palClient.resolveWalletAddressByAlias(
      null,
      pathName
    );

    if (!walletAddress) {
      // An unknown wallet address returns an empty page rather than an
      // error — indistinguishable from a wallet address with no payments,
      // so wallet address existence is not leaked.
      return reply.status(200).send({
        pagination: { hasNextPage: false, hasPreviousPage: false },
        result: []
      });
    }

    try {
      // Open Payments does not expose a sort order, so it is pinned here
      // rather than inherited from the payments-side default. This ensures
      // consistency with Rafiki.
      const page = await paymentsClient.getPaymentsPage({
        sortOrder: 'desc',
        walletAddressId: walletAddress.id,
        cursor: request.query.cursor,
        first:
          request.query.first != null ? Number(request.query.first) : undefined,
        last:
          request.query.last != null ? Number(request.query.last) : undefined
      });

      return reply.status(200).send({
        pagination: page.pagination,
        result: page.items.map((payment) =>
          toOutgoingPaymentBody(payment, openPaymentsUrl)
        )
      });
    } catch (err) {
      const httpStatus = httpStatusFromGrpcError(err);
      return reply.status(httpStatus).send(toClientApiErrorResponse(err));
    }
  });
}
