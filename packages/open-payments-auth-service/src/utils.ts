import { FastifyInstance } from 'fastify';
import * as crypto from 'crypto';
import { AccessItem } from 'auth-client-lib';
import { OpenPaymentsAuthServerRouteError } from './errors';
import { components } from './types/generated/auth-server-types';

const DELIMITER = '_';

export function calculateInteractionHash(
  clientNonce: string,
  finishNonce: string,
  interactRef: string,
  grantUri: string
): string {
  const data = [clientNonce, finishNonce, interactRef, grantUri].join('\n');
  return crypto.createHash('sha256').update(data).digest('base64url');
}

function encodeCompoundId(grantId: string, otherId: string): string {
  return Buffer.from(`${grantId}${DELIMITER}${otherId}`).toString('base64url');
}

export function decodeCompoundId(value: string): {
  grantId: string;
  otherId: string;
} {
  const [grantId, otherId] = Buffer.from(value, 'base64url')
    .toString('utf-8')
    .split(DELIMITER);

  if (!grantId || !otherId) {
    throw new OpenPaymentsAuthServerRouteError(
      404,
      'Malformed id',
      'invalid_request'
    );
  }
  return { grantId, otherId };
}

interface CreateAccessTokenResponseArgs {
  grantId: string;
  accessTokenManagementId: string;
  accessTokenValue: string;
  accessTokenExpiresIn: number;
  access: AccessItem[];
  openPaymentsAuthServerUrl: string;
}

export function createAccessTokenResponse(
  args: CreateAccessTokenResponseArgs
): components['schemas']['access_token'] {
  return {
    value: encodeCompoundId(args.grantId, args.accessTokenValue),
    manage: `${args.openPaymentsAuthServerUrl}/token/${encodeCompoundId(args.grantId, args.accessTokenManagementId)}`,
    expires_in: args.accessTokenExpiresIn,
    access: args.access.map((a) => ({
      actions: a.actions.map((action) =>
        action.toLowerCase().replace('_', '-')
      ),
      type: a.type.toLowerCase().replace('_', '-')
    })) as components['schemas']['access']
  };
}

export function createContinueResponse(
  grantId: string,
  continueId: string,
  continueTokenValue: string,
  openPaymentsAuthServerUrl: string
): components['schemas']['continue'] {
  return {
    access_token: {
      value: continueTokenValue
    },
    // TODO wait
    uri: `${openPaymentsAuthServerUrl}/continue/${encodeCompoundId(grantId, continueId)}`
  };
}

export function createInteractResponse(
  grantId: string,
  interactionNonce: string,
  openPaymentsAuthServerUrl: string
): components['schemas']['interact-response'] {
  return {
    redirect: `${openPaymentsAuthServerUrl}/interact/${grantId}`,
    finish: interactionNonce
  };
}

export function allowEmptyJsonBody(server: FastifyInstance): void {
  const defaultJsonParser = server.getDefaultJsonParser('error', 'error');

  server.removeContentTypeParser('application/json');
  server.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request, body: string, done) => {
      if (body === '') {
        done(null, undefined);
        return;
      }
      defaultJsonParser(request, body, done);
    }
  );
}
