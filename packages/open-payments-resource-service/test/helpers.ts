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
  returnSpentAmounts: boolean;
};

export type ValidateGrantLimitCall = {
  grantId: string;
  debitAmount: bigint;
  receiveAmount: bigint;
  createdAt: string;
};

/**
 * AuthClient stub returning `result` (or throwing it) from introspection and
 * recording calls. `result.spentAmounts` is only returned when the call asks
 * for spent amounts. `validateOutgoingPaymentGrantLimit` succeeds unless
 * `validateGrantLimit.error` is set.
 */
export function stubAuthClient(
  result: IntrospectTokenResult | Error,
  calls: IntrospectTokenCall[] = [],
  validateGrantLimit: {
    calls?: ValidateGrantLimitCall[];
    error?: Error;
  } = {}
): AuthClient {
  return {
    introspectToken: async (
      grantId: string,
      signatureData: SignatureRequestData,
      tokenValue: string,
      access: AccessItem[],
      options: { returnSpentAmounts?: boolean } = {}
    ) => {
      const returnSpentAmounts = options.returnSpentAmounts ?? false;
      calls.push({
        grantId,
        signatureData,
        tokenValue,
        access,
        returnSpentAmounts
      });
      if (result instanceof Error) throw result;
      if (returnSpentAmounts) return result;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { spentAmounts, ...introspection } = result;
      return introspection;
    },
    validateOutgoingPaymentGrantLimit: async (
      grantId: string,
      debitAmount: bigint,
      receiveAmount: bigint,
      createdAt: string
    ) => {
      validateGrantLimit.calls?.push({
        grantId,
        debitAmount,
        receiveAmount,
        createdAt
      });
      if (validateGrantLimit.error) throw validateGrantLimit.error;
      return {
        grantId,
        totalSpentDebitAmount: debitAmount,
        totalSpentReceiveAmount: receiveAmount
      };
    }
  } as unknown as AuthClient;
}

export const activeTokenIntrospectionResult = (
  access: AccessItem[]
): IntrospectTokenResult => ({
  active: true,
  grantId: GRANT_ID,
  access
});
