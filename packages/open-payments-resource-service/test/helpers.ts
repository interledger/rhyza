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

export type IntrospectCall = {
  grantId: string;
  signatureData: SignatureRequestData;
  tokenValue: string;
  access: AccessItem[];
};

/** AuthClient stub returning `result` (or throwing it) and recording calls. */
export function stubAuthClient(
  result: IntrospectTokenResult | Error,
  calls: IntrospectCall[] = []
): AuthClient {
  return {
    introspectToken: async (
      grantId: string,
      signatureData: SignatureRequestData,
      tokenValue: string,
      access: AccessItem[]
    ) => {
      calls.push({ grantId, signatureData, tokenValue, access });
      if (result instanceof Error) throw result;
      return result;
    }
  } as unknown as AuthClient;
}

export const activeResult = (access: AccessItem[]): IntrospectTokenResult => ({
  active: true,
  grantId: GRANT_ID,
  access
});
