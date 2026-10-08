'use strict';

import { randomUUID } from 'crypto';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PalClient, parseAddressToDomainAndPathName } from 'pal-client-lib';
import {
  httpStatusFromGrpcError,
  PaymentsClient,
  toClientApiErrorResponse
} from 'payments-client-lib';
import { OpenPaymentsResourceServerRouteError } from '../errors.js';
import { components } from '../types/generated/resource-server-types.js';
import { decodeCompoundId, encodeCompoundId } from '../utils.js';

interface QuoteRouteOptions extends FastifyPluginOptions {
  palClient: PalClient;
  paymentsClient: PaymentsClient;
  openPaymentsAuthServiceUrl: string;
}

export async function quoteRoutes(
  server: FastifyInstance,
  opts: QuoteRouteOptions
): Promise<void> {
  const { palClient, paymentsClient, openPaymentsAuthServiceUrl } = opts;

  server.get<{
    Params: { id: string };
    Reply:
      | components['schemas']['quote']
      | components['schemas']['error-response'];
  }>('/quotes/:id', async (request, reply) => {
    const { id } = request.params;

    try {
      const { paymentIntentId, quoteId } = decodeCompoundId(id);
      const quote = await paymentsClient.getQuote(paymentIntentId, quoteId);

      if (quote.state !== 'COMPLETED') {
        throw new OpenPaymentsResourceServerRouteError(
          404,
          'Quote not found',
          'not_found'
        );
      }

      const paymentIntent =
        await paymentsClient.getPaymentIntent(paymentIntentId);

      // get sender wallet address for debit amount asset
      const walletAddresses = await palClient.getWalletAddresses([
        quote.senderWalletAddressId
      ]);

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
        id: encodeCompoundId(quote.paymentIntentId, quote.id),
        walletAddress: quote.senderWalletAddress,
        expiresAt: quote.expiresAt,
        debitAmount: {
          value: String(quote.debitAmount),
          assetCode: senderWallet.assetCode,
          assetScale: senderWallet.assetScale
        },
        receiveAmount: {
          value: String(quote.receiveAmount),
          assetCode: paymentIntent.assetCode,
          assetScale: paymentIntent.assetScale
        },
        method: 'ilp',
        createdAt: quote.createdAt,
        receiver:
          paymentIntent.remoteUrl ??
          `${openPaymentsAuthServiceUrl}/incoming-payments/${quote.paymentIntentId}`
      };
      return reply.status(200).send(response);
    } catch (err: unknown) {
      if (err instanceof OpenPaymentsResourceServerRouteError) {
        return reply.status(err.status).send({
          error: {
            code: err.code,
            description: err.message
          }
        });
      }
      const httpStatus = httpStatusFromGrpcError(err);
      return reply.status(httpStatus).send(toClientApiErrorResponse(err));
    }
  });

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
      }
    },
    async (request, reply) => {
      try {
        const {
          walletAddress: walletAddressUrl,
          receiver: incomingPaymentUrl
        } = request.body;

        const { domain, pathName } =
          parseAddressToDomainAndPathName(walletAddressUrl);

        const alias = await palClient.resolveWalletAddressAlias(
          domain,
          pathName
        );

        if (!alias) {
          throw new OpenPaymentsResourceServerRouteError(
            400,
            'Wallet address not found',
            'not_found'
          );
        }

        const walletAddresses = await palClient.getWalletAddresses([
          alias.walletAddressId
        ]);

        if (!walletAddresses.length) {
          throw new OpenPaymentsResourceServerRouteError(
            404,
            'Wallet address not found',
            'not_found'
          );
        }

        const walletAddress = walletAddresses[0];

        let debitAmountValue: number | undefined;
        let receiveAmountValue: number | undefined;

        if ('debitAmount' in request.body && request.body.debitAmount) {
          if (
            request.body.debitAmount.assetCode !== walletAddress.assetCode ||
            request.body.debitAmount.assetScale !== walletAddress.assetScale
          ) {
            throw new OpenPaymentsResourceServerRouteError(
              404,
              'debitAmount asset does not match wallet address asset',
              'invalid_request'
            );
          }
          debitAmountValue = Number(request.body.debitAmount);
        } else if (
          'receiveAmount' in request.body &&
          request.body.receiveAmount
        ) {
          receiveAmountValue = Number(request.body.receiveAmount);
        }

        const id = randomUUID();

        const result = await paymentsClient.createQuote(
          id,
          { incomingPaymentUrl },
          alias.walletAddressId,
          walletAddressUrl,
          debitAmountValue,
          receiveAmountValue
        );

        const paymentIntent = await paymentsClient.getPaymentIntent(
          result.paymentIntentId
        );

        const response: components['schemas']['quote'] = {
          id: encodeCompoundId(result.paymentIntentId, result.id),
          walletAddress: result.senderWalletAddress,
          expiresAt: result.expiresAt,
          debitAmount: {
            value: String(result.debitAmount),
            assetCode: walletAddress.assetCode,
            assetScale: walletAddress.assetScale
          },
          receiveAmount: {
            value: String(result.receiveAmount),
            assetCode: paymentIntent.assetCode,
            assetScale: paymentIntent.assetScale
          },
          method: 'ilp',
          createdAt: result.createdAt,
          receiver:
            paymentIntent.remoteUrl ??
            `${openPaymentsAuthServiceUrl}/incoming-payments/${result.paymentIntentId}`
        };

        return reply.status(201).send(response);
      } catch (err: unknown) {
        if (err instanceof OpenPaymentsResourceServerRouteError) {
          return reply.status(err.status).send({
            error: {
              code: err.code,
              description: err.message
            }
          });
        }
        const httpStatus = httpStatusFromGrpcError(err);
        return reply.status(httpStatus).send(toClientApiErrorResponse(err));
      }
    }
  );
}
