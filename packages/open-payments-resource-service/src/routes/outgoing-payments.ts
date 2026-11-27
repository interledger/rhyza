'use strict';

import { randomUUID } from 'crypto';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PalClient, pathNameFromWalletAddress } from 'pal-client-lib';
import {
  httpStatusFromGrpcError,
  IAmount,
  PaymentsClient,
  IPayment
} from 'payments-client-lib';
import {
  AccessLimits,
  AuthClient,
  AuthClientInsufficientGrantError,
  GrantSpentAmountsResult,
  AuthClientInvalidGrantError,
  isAuthClientError
} from 'auth-client-lib';
import { OpenPaymentsResourceServerRouteError } from '../errors.js';
import {
  AccessType,
  assertGrantIdentifierMatches,
  introspectToken,
  RequestAction
} from '../auth.js';
import {
  components,
  operations
} from '../types/generated/resource-server-types.js';
import { decodeCompoundId, encodeCompoundId } from '../utils.js';

interface OutgoingPaymentRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
  paymentsClient: PaymentsClient;
  authClient: AuthClient;
  /** Base URL of this instance's Open Payments resource server, used to construct receiver URLs for LOCAL parents. */
  openPaymentsUrl: string;
  openPaymentsAuthServiceUrl: string;
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

type OutgoingPaymentGrantBody =
  operations['get-outgoing-payment-grant']['responses'][200]['content']['application/json'];

function toOutgoingPaymentGrantSpentAmountsBody(
  limits: AccessLimits | undefined,
  spent: GrantSpentAmountsResult | null
): OutgoingPaymentGrantBody {
  if (!spent) return { spentDebitAmount: null, spentReceiveAmount: null };

  const toSpentAmount = (
    limit: AccessLimits['debitAmount'],
    total: bigint,
    interval: bigint | undefined
  ): components['schemas']['amount'] | null => {
    if (!limit) return null;
    const value = limits?.interval ? (interval ?? 0n) : total;
    return {
      value: String(value),
      assetCode: limit.assetCode,
      assetScale: limit.assetScale
    };
  };

  return {
    spentDebitAmount: toSpentAmount(
      limits?.debitAmount,
      spent.totalSpentDebitAmount,
      spent.intervalSpentDebitAmount
    ),
    spentReceiveAmount: toSpentAmount(
      limits?.receiveAmount,
      spent.totalSpentReceiveAmount,
      spent.intervalSpentReceiveAmount
    )
  };
}

export async function outgoingPaymentRoutes(
  server: FastifyInstance,
  opts: OutgoingPaymentRouteOptions
): Promise<void> {
  const {
    palClient,
    paymentsClient,
    authClient,
    openPaymentsUrl,
    openPaymentsAuthServiceUrl
  } = opts;

  const introspectionOpts = {
    authClient,
    authServerUrl: openPaymentsAuthServiceUrl,
    type: AccessType.OutgoingPayment
  };

  server.post<{
    Body: components['schemas']['create-outgoing-payment-request'];
  }>(
    '/outgoing-payments',
    {
      schema: {
        body: { $ref: '#/components/schemas/create-outgoing-payment-request#' }
      },
      preHandler: async (request, reply) =>
        await introspectToken(request, reply, {
          ...introspectionOpts,
          action: RequestAction.Create,
          identifier: request.body.walletAddress
        })
    },
    async (request, reply) => {
      const { walletAddress: walletAddressUrl, metadata } = request.body;

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

      const grantId = request.grantId!;

      try {
        // Open Payments requires a receiveAmount on the created outgoing payment, but
        // we will not have one if it is created without a quote (only debit amount).
        // A quote is created here as a workaround. Its amounts are also what
        // the grant spend limit is checked against.
        const quote =
          quoteSource.kind === 'existing'
            ? await paymentsClient.getQuote(
                quoteSource.paymentIntentId,
                quoteSource.resourceId
              )
            : await paymentsClient.createQuote(
                randomUUID(),
                { paymentIntentUrl: quoteSource.incomingPaymentUrl },
                walletAddress.id,
                walletAddressUrl,
                quoteSource.debitAmountValue
              );

        if (
          quote.debitAmount === undefined ||
          quote.receiveAmount === undefined
        ) {
          throw new OpenPaymentsResourceServerRouteError(
            400,
            'Quote has no debit or receive amount',
            'invalid_request'
          );
        }

        const createdAt = new Date().toISOString();

        try {
          await authClient.validateOutgoingPaymentGrantLimit(
            grantId,
            quote.debitAmount,
            quote.receiveAmount,
            createdAt
          );
        } catch (err) {
          if (
            err instanceof AuthClientInsufficientGrantError ||
            err instanceof AuthClientInvalidGrantError
          ) {
            throw new OpenPaymentsResourceServerRouteError(
              403,
              'Insufficient Grant',
              'insufficient_grant'
            );
          }
          throw err;
        }

        const { payment } = await paymentsClient.createPayment(
          randomUUID(),
          { paymentIntentId: quote.paymentIntentId },
          walletAddress.id,
          walletAddressUrl,
          quote.id,
          undefined, // debitAmount
          createdAt,
          grantId,
          metadata
        );

        return reply
          .status(201)
          .send(toOutgoingPaymentBody(payment, openPaymentsUrl));
      } catch (err) {
        if (
          err instanceof OpenPaymentsResourceServerRouteError ||
          isAuthClientError(err)
        ) {
          throw err;
        }
        const httpStatus = httpStatusFromGrpcError(err);

        if (httpStatus === 400 || httpStatus === 409) {
          throw new OpenPaymentsResourceServerRouteError(
            400,
            'Could not create outgoing payment',
            'invalid_request'
          );
        }

        throw new OpenPaymentsResourceServerRouteError(
          500,
          'Could not create outgoing payment',
          'internal_server_error'
        );
      }
    }
  );

  server.get<{ Params: { id: string } }>(
    '/outgoing-payments/:id',
    {
      preHandler: async (request, reply) =>
        await introspectToken(request, reply, {
          ...introspectionOpts,
          action: RequestAction.Read
        })
    },
    async (request, reply) => {
      const { paymentIntentId, resourceId: paymentId } = decodeCompoundId(
        request.params.id
      );

      let payment: IPayment;
      try {
        payment = await paymentsClient.getPayment(paymentIntentId, paymentId);
      } catch (err) {
        if (httpStatusFromGrpcError(err) === 404) {
          throw new OpenPaymentsResourceServerRouteError(
            404,
            'Outgoing payment not found',
            'not_found'
          );
        }

        throw new OpenPaymentsResourceServerRouteError(
          500,
          'Could not get outgoing payment',
          'internal_server_error'
        );
      }

      assertGrantIdentifierMatches(request, payment.senderWalletAddress);

      return reply
        .status(200)
        .send(toOutgoingPaymentBody(payment, openPaymentsUrl));
    }
  );

  server.get(
    '/outgoing-payment-grant',
    {
      preHandler: async (request, reply) =>
        await introspectToken(request, reply, {
          ...introspectionOpts,
          action: RequestAction.Create,
          returnSpentAmounts: true
        })
    },
    async (request, reply) => {
      return reply
        .status(200)
        .send(
          toOutgoingPaymentGrantSpentAmountsBody(
            request.grantAccess?.limits,
            request.grantSpentAmounts
          )
        );
    }
  );

  server.get<{
    Querystring: {
      'wallet-address': string;
      cursor?: string;
      first?: string;
      last?: string;
    };
  }>(
    '/outgoing-payments',
    {
      preHandler: async (request, reply) =>
        await introspectToken(request, reply, {
          ...introspectionOpts,
          action: RequestAction.List,
          identifier: request.query['wallet-address']
        })
    },
    async (request, reply) => {
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
            request.query.first != null
              ? Number(request.query.first)
              : undefined,
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
        if (httpStatusFromGrpcError(err) === 400) {
          throw new OpenPaymentsResourceServerRouteError(
            400,
            'Could not list outgoing payments',
            'invalid_request'
          );
        }

        throw new OpenPaymentsResourceServerRouteError(
          500,
          'Could not list outgoing payments',
          'internal_server_error'
        );
      }
    }
  );
}
