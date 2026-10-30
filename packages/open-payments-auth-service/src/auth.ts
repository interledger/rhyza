import { SignatureRequestData } from 'auth-client-lib';
import { FastifyRequest } from 'fastify';
import { OpenPaymentsAuthServerRouteError } from './errors';

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
  const cleanHeaders: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;

    cleanHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  return cleanHeaders;
}

export function extractSignatureData(
  request: FastifyRequest
): SignatureRequestData {
  const cleanedHeaders = cleanHeaders(request.headers);

  if (!cleanedHeaders['signature-input']) {
    throw new OpenPaymentsAuthServerRouteError(
      401,
      'missing signature input',
      'invalid_client'
    );
  }

  const keyId = extractKeyId(cleanedHeaders['signature-input']);

  if (!keyId) {
    throw new OpenPaymentsAuthServerRouteError(
      401,
      'missing key-id in signature input',
      'invalid_client'
    );
  }

  return {
    url: `${request.protocol}://${request.headers.host}${request.url}`,
    method: request.method,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    headers: cleanHeaders(request.headers),
    kid: keyId
  };
}

export function requireSignatureHeaders(request: FastifyRequest): void {
  if (!request.headers['signature']) {
    throw new OpenPaymentsAuthServerRouteError(
      401,
      'Missing signature header',
      'invalid_client'
    );
  }

  if (!request.headers['signature-input']) {
    throw new OpenPaymentsAuthServerRouteError(
      401,
      'Missing signature-input header',
      'invalid_client'
    );
  }
}

export function getGnapTokenOrThrow(request: FastifyRequest): void {
  (request as FastifyRequest & { gnapToken: string }).gnapToken =
    extractGnapToken(request);
}

function extractGnapToken(request: FastifyRequest): string {
  const header = request.headers['authorization'];
  if (!header) {
    throw new OpenPaymentsAuthServerRouteError(
      401,
      'Missing authorization header',
      'invalid_client'
    );
  }

  const gnapToken = header.replace('GNAP ', '').trim();
  if (!gnapToken) {
    throw new OpenPaymentsAuthServerRouteError(
      401,
      'Missing GNAP access token',
      'invalid_client'
    );
  }

  return gnapToken;
}
