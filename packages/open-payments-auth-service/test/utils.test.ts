import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccessTokenResponse } from '../src/utils';

const AUTH_SERVER_URL = 'https://auth.example';

describe('createAccessTokenResponse', () => {
  test('includes identifier and limits on outgoing-payment access items', () => {
    const response = createAccessTokenResponse({
      grantId: 'grant-1',
      accessTokenValue: 'token-1',
      accessTokenManagementId: 'mgmt-1',
      accessTokenExpiresIn: 10000,
      openPaymentsAuthServerUrl: AUTH_SERVER_URL,
      access: [
        {
          type: 'OUTGOING_PAYMENT',
          actions: ['CREATE', 'READ', 'READ_ALL'],
          identifier: 'https://wallet.example/alice',
          limits: {
            debitAmount: {
              value: '2500',
              assetCode: 'USD',
              assetScale: 2
            },
            interval: 'R/2026-10-28T00:00:00Z/P1M'
          }
        }
      ]
    });

    assert.deepEqual(response.access, [
      {
        type: 'outgoing-payment',
        actions: ['create', 'read', 'read-all'],
        identifier: 'https://wallet.example/alice',
        limits: {
          debitAmount: {
            value: '2500',
            assetCode: 'USD',
            assetScale: 2
          },
          interval: 'R/2026-10-28T00:00:00Z/P1M'
        }
      }
    ]);
  });

  test('includes optional identifier on incoming-payment access items', () => {
    const response = createAccessTokenResponse({
      grantId: 'grant-1',
      accessTokenValue: 'token-1',
      accessTokenManagementId: 'mgmt-1',
      accessTokenExpiresIn: 600,
      openPaymentsAuthServerUrl: AUTH_SERVER_URL,
      access: [
        {
          type: 'INCOMING_PAYMENT',
          actions: ['CREATE', 'COMPLETE'],
          identifier: 'https://wallet.example/bob'
        }
      ]
    });

    assert.deepEqual(response.access, [
      {
        type: 'incoming-payment',
        actions: ['create', 'complete'],
        identifier: 'https://wallet.example/bob'
      }
    ]);
  });

  test('throws when an outgoing-payment access item has no identifier', () => {
    assert.throws(
      () =>
        createAccessTokenResponse({
          grantId: 'grant-1',
          accessTokenValue: 'token-1',
          accessTokenManagementId: 'mgmt-1',
          accessTokenExpiresIn: 600,
          openPaymentsAuthServerUrl: AUTH_SERVER_URL,
          access: [{ type: 'OUTGOING_PAYMENT', actions: ['CREATE'] }]
        }),
      /no identifier/
    );
  });

  test('omits identifier and limits when absent', () => {
    const response = createAccessTokenResponse({
      grantId: 'grant-1',
      accessTokenValue: 'token-1',
      accessTokenManagementId: 'mgmt-1',
      accessTokenExpiresIn: 600,
      openPaymentsAuthServerUrl: AUTH_SERVER_URL,
      access: [
        {
          type: 'QUOTE',
          actions: ['CREATE', 'READ']
        }
      ]
    });

    assert.deepEqual(response.access, [
      {
        type: 'quote',
        actions: ['create', 'read']
      }
    ]);
  });
});
