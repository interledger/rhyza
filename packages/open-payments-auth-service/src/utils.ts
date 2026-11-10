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

/**
 * Access token values are handed out as a compound of the grant id and the raw
 * token (see createAccessTokenResponse). Returns the raw token, as long as the
 * value decodes and was issued for the given grant.
 */
export function decodeAccessTokenValue(value: string, grantId: string): string {
  let decoded: { grantId: string; otherId: string } | undefined;
  try {
    decoded = decodeCompoundId(value);
  } catch {
    decoded = undefined;
  }

  if (!decoded || decoded.grantId !== grantId) {
    throw new OpenPaymentsAuthServerRouteError(
      401,
      'Invalid access token',
      'invalid_client'
    );
  }
  return decoded.otherId;
}

interface CreateAccessTokenResponseArgs {
  grantId: string;
  accessTokenManagementId: string;
  accessTokenValue: string;
  accessTokenExpiresIn: number;
  access: AccessItem[];
  openPaymentsAuthServerUrl: string;
}

type AccessIncoming = components['schemas']['access-incoming'];
type AccessOutgoing = components['schemas']['access-outgoing'];
type AccessQuote = components['schemas']['access-quote'];

function toActionsResponse(actions: string[]): string[] {
  return actions.map((action) => action.toLowerCase().replaceAll('_', '-'));
}

// Maps each stored access type explicitly, so the type checker enforces the
// fields the spec requires per type (e.g. `identifier` on outgoing-payment).
function toAccessItemResponse(
  item: AccessItem
): components['schemas']['access-item'] {
  switch (item.type) {
    case 'INCOMING_PAYMENT':
      return {
        type: 'incoming-payment',
        actions: toActionsResponse(item.actions) as AccessIncoming['actions'],
        ...(item.identifier !== undefined && { identifier: item.identifier })
      };
    case 'OUTGOING_PAYMENT':
      // The grant request schema requires an identifier for outgoing-payment.
      if (item.identifier === undefined) {
        throw new Error(
          'Stored outgoing-payment access item has no identifier'
        );
      }
      return {
        type: 'outgoing-payment',
        actions: toActionsResponse(item.actions) as AccessOutgoing['actions'],
        identifier: item.identifier,
        ...(item.limits !== undefined && { limits: item.limits })
      };
    case 'QUOTE':
      return {
        type: 'quote',
        actions: toActionsResponse(item.actions) as AccessQuote['actions']
      };
    default:
      throw new Error(`Unknown access type: ${item.type}`);
  }
}

export function createAccessTokenResponse(
  args: CreateAccessTokenResponseArgs
): components['schemas']['access_token'] {
  return {
    value: encodeCompoundId(args.grantId, args.accessTokenValue),
    manage: `${args.openPaymentsAuthServerUrl}/token/${encodeCompoundId(args.grantId, args.accessTokenManagementId)}`,
    expires_in: args.accessTokenExpiresIn,
    access: args.access.map(toAccessItemResponse)
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
    redirect: `${openPaymentsAuthServerUrl}/interaction/${grantId}/start`,
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
