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

export type IntrospectTokenCall = {
  grantId: string;
  signatureData: SignatureRequestData;
  tokenValue: string;
  access: AccessItem[];
};

export function stubAuthClient(
  result: IntrospectTokenResult | Error,
  calls: IntrospectTokenCall[] = []
): AuthClient {
  const introspectToken: IntrospectToken = async (
    grantId,
    signatureData,
    tokenValue,
    access
  ) => {
    calls.push({ grantId, signatureData, tokenValue, access });
    if (result instanceof Error) throw result;
    return result;
  };

  return { introspectToken } as unknown as AuthClient;
}

type IntrospectToken = (
  grantId: string,
  signatureData: SignatureRequestData,
  tokenValue: string,
  access: AccessItem[]
) => Promise<IntrospectTokenResult>;

export const activeTokenIntrospectionResult = (
  access: AccessItem[]
): IntrospectTokenResult => ({
  active: true,
  grantId: GRANT_ID,
  access
});
