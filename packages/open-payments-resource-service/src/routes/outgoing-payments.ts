'use strict';

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PalClient, parseAddressToDomainAndPathName } from 'pal-client-lib';
import {
  httpStatusFromGrpcError,
  toClientApiErrorResponse,
  IAmount,
  PaymentsClient,
  GetPaymentResult
} from 'payments-client-lib';
import { OpenPaymentsResourceServerRouteError } from '../errors.js';
import { components } from '../types/generated/resource-server-types.js';

interface OutgoingPaymentRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
  paymentsClient: PaymentsClient;
  /** Base URL of this node's Open Payments resource server, used to construct receiver URLs for LOCAL parents. */
  openPaymentsUrl: string;
}

function toAmountBody(amount: IAmount): components['schemas']['amount'] {
  return {
    value: String(amount.value),
    assetCode: amount.assetCode,
    assetScale: amount.assetScale
  };
}

function toOutgoingPaymentBody(
  payment: GetPaymentResult,
  openPaymentsUrl: string
): components['schemas']['outgoing-payment'] {
  // REMOTE parents carry the peer's incoming payment URL; for LOCAL
  // parents the receiver is this node's own incoming payment resource.
  const receiver =
    payment.remoteUrl ??
    `${openPaymentsUrl}/incoming-payments/${payment.paymentIntentId}`;

  return {
    id: payment.id,
    walletAddress: payment.senderWalletAddress,
    receiver,
    failed: payment.state === 'FAILED',
    ...(payment.quoteId ? { quoteId: payment.quoteId } : {}),
    debitAmount: toAmountBody(payment.debitAmount),
    receiveAmount: toAmountBody(payment.receiveAmount),
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

    const { domain, pathName } =
      parseAddressToDomainAndPathName(walletAddressUrl);
    const alias = await palClient.resolveWalletAddressAlias(domain, pathName);

    if (!alias) {
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
        walletAddressId: alias.walletAddressId,
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
