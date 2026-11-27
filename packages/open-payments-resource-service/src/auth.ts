import { FastifyReply, FastifyRequest } from 'fastify';
import {
  AccessItem,
  AuthClient,
  AuthClientPermissionDeniedError,
  GrantSpentAmountsResult,
  IntrospectTokenResult,
  SignatureRequestData
} from 'auth-client-lib';
import { pathNameFromWalletAddress } from 'pal-client-lib';
import { OpenPaymentsResourceServerRouteError } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    grantAccess: AccessItem | null;
    grantId: string | null;
    // Only set when introspecting with `returnSpentAmounts`.
    grantSpentAmounts: GrantSpentAmountsResult | null;
  }
}

export const AccessType = {
  IncomingPayment: 'INCOMING_PAYMENT',
  OutgoingPayment: 'OUTGOING_PAYMENT',
  Quote: 'QUOTE'
} as const;
export type AccessType = (typeof AccessType)[keyof typeof AccessType];

export const RequestAction = {
  Create: 'CREATE',
  Read: 'READ',
  Complete: 'COMPLETE',
  List: 'LIST'
} as const;
export type RequestAction = (typeof RequestAction)[keyof typeof RequestAction];

const DELIMITER = '_';

export function decodeAccessTokenValue(
  value: string
): { grantId: string; tokenValue: string } | undefined {
  const [grantId, tokenValue] = Buffer.from(value, 'base64url')
    .toString('utf-8')
    .split(DELIMITER);

  if (!grantId || !tokenValue) return undefined;
  return { grantId, tokenValue };
}

function extractKeyId(signatureInput: string): string | undefined {
  const KEY_ID_PREFIX = 'keyid="';

  const keyIdParam = signatureInput
    .split(';')
    .find((param) => param.startsWith(KEY_ID_PREFIX));
  return keyIdParam?.slice(KEY_ID_PREFIX.length, -1);
}

function cleanHeaders(
  headers: FastifyRequest['headers']
): Record<string, string> {
  const cleaned: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    cleaned[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  return cleaned;
}

export function extractSignatureData(
  request: FastifyRequest
): SignatureRequestData {
  const headers = cleanHeaders(request.headers);

  if (!headers['signature']) {
    throw new OpenPaymentsResourceServerRouteError(
      401,
      'Missing signature header',
      'invalid_signature'
    );
  }

  if (!headers['signature-input']) {
    throw new OpenPaymentsResourceServerRouteError(
      401,
      'Missing signature-input header',
      'invalid_signature'
    );
  }

  const keyId = extractKeyId(headers['signature-input']);
  if (!keyId) {
    throw new OpenPaymentsResourceServerRouteError(
      401,
      'Missing key-id in signature input',
      'invalid_signature'
    );
  }

  return {
    url: `${request.protocol}://${request.headers.host}${request.url}`,
    method: request.method,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    headers,
    kid: keyId
  };
}

function extractGnapToken(request: FastifyRequest): string {
  const parts = request.headers['authorization']?.split(' ');
  if (parts?.length !== 2 || parts[0] !== 'GNAP' || !parts[1]) {
    throw new OpenPaymentsResourceServerRouteError(
      401,
      'Missing or invalid authorization header value',
      'invalid_token'
    );
  }
  return parts[1];
}

export interface TokenIntrospectionOptions {
  authClient: AuthClient;
  authServerUrl: string;
  type: AccessType;
  action: RequestAction;
  identifier?: string;
  returnSpentAmounts?: boolean;
}

export async function introspectToken(
  request: FastifyRequest,
  reply: FastifyReply,
  opts: TokenIntrospectionOptions
): Promise<void> {
  const { authClient, authServerUrl, type, action } = opts;

  request.grantAccess = null;
  request.grantId = null;
  request.grantSpentAmounts = null;

  try {
    const token = extractGnapToken(request);
    const signatureData = extractSignatureData(request);

    const decoded = decodeAccessTokenValue(token);
    if (!decoded) {
      throw new OpenPaymentsResourceServerRouteError(
        401,
        'Invalid Token',
        'invalid_token'
      );
    }

    const requestedAccess: AccessItem = { type, actions: [action] };

    if (opts.identifier) {
      requestedAccess.identifier = opts.identifier;
    }

    let tokenInfo: IntrospectTokenResult;
    try {
      tokenInfo = await authClient.introspectToken(
        decoded.grantId,
        signatureData,
        decoded.tokenValue,
        [requestedAccess],
        { returnSpentAmounts: opts.returnSpentAmounts }
      );
    } catch (err) {
      if (err instanceof AuthClientPermissionDeniedError) {
        throw new OpenPaymentsResourceServerRouteError(
          401,
          'Invalid signature',
          'invalid_signature'
        );
      }
      throw err;
    }

    if (!tokenInfo.active) {
      throw new OpenPaymentsResourceServerRouteError(
        403,
        'Inactive Token',
        'inactive_token'
      );
    }

    if (tokenInfo.access.length === 0) {
      throw new OpenPaymentsResourceServerRouteError(
        403,
        'Insufficient Grant',
        'insufficient_grant'
      );
    }

    request.grantAccess = tokenInfo.access[0]!;
    request.grantId = tokenInfo.grantId;
    request.grantSpentAmounts = tokenInfo.spentAmounts ?? null;
  } catch (err) {
    if (
      err instanceof OpenPaymentsResourceServerRouteError &&
      (err.status === 401 || err.status === 403)
    ) {
      // This lets the resource server that rejects a
      // request tell the client where to get a suitable grant: a 401/403 may
      // carry `WWW-Authenticate: GNAP as_uri=<AS grant endpoint>`, pointing the
      // client at the AS it should start a new grant request with.
      reply.header('WWW-Authenticate', `GNAP as_uri=${authServerUrl}`);
    }
    throw err;
  }
}

export function assertGrantIdentifierMatches(
  request: FastifyRequest,
  resourceWalletAddress: string
): void {
  const identifier = request.grantAccess?.identifier;
  if (!identifier) return;

  const error = new OpenPaymentsResourceServerRouteError(
    403,
    'Insufficient Grant',
    'insufficient_grant'
  );

  try {
    if (
      pathNameFromWalletAddress(identifier) !==
      pathNameFromWalletAddress(resourceWalletAddress)
    ) {
      throw error;
    }
  } catch {
    throw error;
  }
}
