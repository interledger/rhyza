'use strict';

import { randomUUID } from 'crypto';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  IGetWalletAddressResponse,
  PalClient,
  pathNameFromWalletAddress
} from 'pal-client-lib';
import {
  CreateQuoteResult,
  GetQuoteResult,
  httpStatusFromGrpcError,
  PaymentsClient
} from 'payments-client-lib';
import { AuthClient } from 'auth-client-lib';
import { OpenPaymentsResourceServerRouteError } from '../errors.js';
import {
  AccessType,
  assertGrantIdentifierMatches,
  introspectToken,
  RequestAction
} from '../auth.js';
import { components } from '../types/generated/resource-server-types.js';
import { decodeCompoundId, encodeCompoundId } from '../utils.js';

interface QuoteRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
  paymentsClient: PaymentsClient;
  authClient: AuthClient;
  openPaymentsUrl: string;
  openPaymentsAuthServiceUrl: string;
}

export async function quoteRoutes(
  server: FastifyInstance,
  opts: QuoteRouteOptions
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
    type: AccessType.Quote
  };

  server.get<{
    Params: { id: string };
    Reply:
      | components['schemas']['quote']
      | components['schemas']['error-response'];
  }>(
    '/quotes/:id',
    {
      preHandler: async (request, reply) =>
        await introspectToken(request, reply, {
          ...introspectionOpts,
          action: RequestAction.Read
        })
    },
    async (request, reply) => {
      const { id } = request.params;

      const { paymentIntentId, resourceId: quoteId } = decodeCompoundId(id);

      let quote: GetQuoteResult;
      try {
        quote = await paymentsClient.getQuote(paymentIntentId, quoteId);
      } catch (err) {
        if (httpStatusFromGrpcError(err) === 404) {
          throw new OpenPaymentsResourceServerRouteError(
            404,
            'Quote not found',
            'not_found'
          );
        }

        throw new OpenPaymentsResourceServerRouteError(
          500,
          'Could not get quote',
          'internal_server_error'
        );
      }

      assertGrantIdentifierMatches(request, quote.senderWalletAddress);

      if (quote.state !== 'COMPLETED') {
        throw new OpenPaymentsResourceServerRouteError(
          404,
          'Quote not found',
          'not_found'
        );
      }

      // get sender wallet address for debit amount asset
      let walletAddresses: IGetWalletAddressResponse[];
      try {
        walletAddresses = await palClient.getWalletAddresses([
          quote.senderWalletAddressId
        ]);
      } catch {
        throw new OpenPaymentsResourceServerRouteError(
          500,
          'Could not get quote',
          'internal_server_error'
        );
      }

      const senderWallet = walletAddresses.find(
        (wallet) => wallet.id === quote.senderWalletAddressId
      );

      if (!senderWallet) {
        throw new OpenPaymentsResourceServerRouteError(
          404,
          'Sender wallet address not found',
          'not_found'
        );
      }

      // build response
      const response: components['schemas']['quote'] = {
        id: `${openPaymentsUrl}/quotes/${encodeCompoundId(quote.paymentIntentId, quote.id)}`,
        walletAddress: quote.senderWalletAddress,
        expiresAt: quote.expiresAt,
        debitAmount: {
          value: String(quote.debitAmount),
          assetCode: senderWallet.assetCode,
          assetScale: senderWallet.assetScale
        },
        receiveAmount: {
          value: String(quote.receiveAmount),
          assetCode: quote.receiveAssetCode,
          assetScale: quote.receiveAssetScale
        },
        method: 'ilp',
        createdAt: quote.createdAt,
        receiver:
          quote.paymentIntentRemoteUrl ??
          `${openPaymentsUrl}/incoming-payments/${quote.paymentIntentId}`
      };
      return reply.status(200).send(response);
    }
  );

  server.post<{
    Body: components['schemas']['create-quote-request'];
    Reply:
      | components['schemas']['quote']
      | components['schemas']['error-response'];
  }>(
    '/quotes',
    {
      schema: {
        body: { $ref: '#/components/schemas/create-quote-request#' }
      },
      preHandler: async (request, reply) =>
        await introspectToken(request, reply, {
          ...introspectionOpts,
          action: RequestAction.Create,
          identifier: request.body.walletAddress
        })
    },
    async (request, reply) => {
      const { walletAddress: walletAddressUrl, receiver: incomingPaymentUrl } =
        request.body;

      const pathName = pathNameFromWalletAddress(walletAddressUrl);

      let walletAddress: IGetWalletAddressResponse | null;
      try {
        walletAddress = await palClient.resolveWalletAddressByAlias(
          null,
          pathName
        );
      } catch {
        throw new OpenPaymentsResourceServerRouteError(
          500,
          'Could not create quote',
          'internal_server_error'
        );
      }

      if (!walletAddress) {
        throw new OpenPaymentsResourceServerRouteError(
          404,
          'Wallet address not found',
          'not_found'
        );
      }

      let debitAmountValue: number | undefined;
      let receiveAmountValue: number | undefined;

      if ('debitAmount' in request.body && request.body.debitAmount) {
        if (
          request.body.debitAmount.assetCode !== walletAddress.assetCode ||
          request.body.debitAmount.assetScale !== walletAddress.assetScale
        ) {
          throw new OpenPaymentsResourceServerRouteError(
            400,
            'debitAmount asset does not match wallet address asset',
            'invalid_request'
          );
        }
        debitAmountValue = Number(request.body.debitAmount.value);
      } else if (
        'receiveAmount' in request.body &&
        request.body.receiveAmount
      ) {
        receiveAmountValue = Number(request.body.receiveAmount.value);
      }

      const id = randomUUID();

      let result: CreateQuoteResult;
      try {
        result = await paymentsClient.createQuote(
          id,
          { paymentIntentUrl: incomingPaymentUrl },
          walletAddress.id,
          walletAddressUrl,
          debitAmountValue,
          receiveAmountValue
        );
      } catch (err) {
        const httpStatus = httpStatusFromGrpcError(err);

        if (httpStatus === 400 || httpStatus === 409) {
          throw new OpenPaymentsResourceServerRouteError(
            400,
            'Could not create quote',
            'invalid_request'
          );
        }

        throw new OpenPaymentsResourceServerRouteError(
          500,
          'Could not create quote',
          'internal_server_error'
        );
      }

      const response: components['schemas']['quote'] = {
        id: `${openPaymentsUrl}/quotes/${encodeCompoundId(result.paymentIntentId, result.id)}`,
        walletAddress: result.senderWalletAddress,
        expiresAt: result.expiresAt,
        debitAmount: {
          value: String(result.debitAmount),
          assetCode: walletAddress.assetCode,
          assetScale: walletAddress.assetScale
        },
        receiveAmount: {
          value: String(result.receiveAmount),
          assetCode: result.receiveAssetCode,
          assetScale: result.receiveAssetScale
        },
        method: 'ilp',
        createdAt: result.createdAt,
        receiver:
          result.paymentIntentRemoteUrl ??
          `${openPaymentsUrl}/incoming-payments/${result.paymentIntentId}`
      };

      return reply.status(201).send(response);
    }
  );
}
