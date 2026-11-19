import { mock } from 'node:test';
import {
  AccessItem,
  AuthClient,
  IntrospectTokenResult,
  SignatureRequestData
} from 'auth-client-lib';

export const GRANT_ID = 'grant-1';
export const RAW_TOKEN = 'raw-token';
export const TOKEN = Buffer.from(`${GRANT_ID}_${RAW_TOKEN}`).toString(
  'base64url'
);

export const signedAuthHeaders = (token: string = TOKEN) => ({
  authorization: `GNAP ${token}`,
  signature: 'sig1=:c2lnbmF0dXJl:',
  'signature-input': 'sig1=("@method" "@target-uri");keyid="key-1";created=1'
});

export function stubAuthClient(
  result: IntrospectTokenResult | Error
): AuthClient {
  return spyAuthClient(result).authClient;
}

export function spyAuthClient(result: IntrospectTokenResult | Error): {
  authClient: AuthClient;
  introspectToken: ReturnType<typeof introspectTokenMock>;
} {
  const introspectToken = introspectTokenMock(result);

  return {
    authClient: { introspectToken } as unknown as AuthClient,
    introspectToken
  };
}

type IntrospectToken = (
  grantId: string,
  signatureData: SignatureRequestData,
  tokenValue: string,
  access: AccessItem[]
) => Promise<IntrospectTokenResult>;

function introspectTokenMock(result: IntrospectTokenResult | Error) {
  const introspect: IntrospectToken = async () => {
    if (result instanceof Error) throw result;
    return result;
  };

  return mock.fn(introspect);
}

export const activeTokenIntrospectionResult = (
  access: AccessItem[]
): IntrospectTokenResult => ({
  active: true,
  grantId: GRANT_ID,
  access
});
