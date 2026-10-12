import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    remotePayments: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 500 },
        { duration: '15s', target: 500 },
        { duration: '15s', target: 0 }
      ]
    }
  }
};

const ADMIN_A_URL = 'http://localhost:3001';
const ADMIN_B_URL = 'http://localhost:4001';
const SENDER_PATH_NAME = 'sender';
const RECEIVER_PATH_NAME = 'receiver';
const PEER_AUTH_TOKEN = 'local-peer-token';
const PEER_A_TO_B = {
  id: '04978037-26b8-4b4d-854a-278ed7548959',
  ilpStaticAddress: 'private.rafiki.b',
  endpoint: 'http://ilp-connector-service-b:4000/ilp'
};
const PEER_B_TO_A = {
  id: '9f3c1e2a-4b5d-4c6e-8a7f-1b2c3d4e5f60',
  ilpStaticAddress: 'private.rafiki.a',
  endpoint: 'http://ilp-connector-service:4000/ilp'
};

const INCOMING_AMOUNT = 1000;
const DEBIT_AMOUNT = '1000';
const SENDER_LIQUIDITY = 100_000_000_000;

function post(url, data) {
  return http.post(url, JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }
  });
}

function createdOrExists(r) {
  return r.status === 201 || r.status === 409;
}

function safeJson(res) {
  try {
    return JSON.parse(res.body);
  } catch {
    return undefined;
  }
}

export function setup() {
  // ---- Node A (sender) ----
  check(post(`${ADMIN_A_URL}/assets`, { code: 'USD', scale: 2 }), {
    'A: asset created or exists': createdOrExists
  });
  const senderWalletRes = post(`${ADMIN_A_URL}/wallet-addresses`, {
    assetCode: 'USD',
    pathName: SENDER_PATH_NAME,
    publicName: 'Sender (Node A)'
  });
  check(senderWalletRes, {
    'A: sender wallet created or exists': createdOrExists
  });
  const senderWallet = safeJson(senderWalletRes);
  check(
    post(`${ADMIN_A_URL}/peers`, {
      id: PEER_A_TO_B.id,
      name: 'Node B',
      assetCode: 'USD',
      assetScale: 2,
      ilpStaticAddress: PEER_A_TO_B.ilpStaticAddress,
      http: {
        outgoing: {
          endpoint: PEER_A_TO_B.endpoint,
          authToken: PEER_AUTH_TOKEN
        },
        incoming: { authToken: PEER_AUTH_TOKEN }
      }
    }),
    { 'A: peer-for-B created or exists': createdOrExists }
  );
  check(
    post(`${ADMIN_A_URL}/liquidity/deposit`, {
      assetCode: 'USD',
      peerId: PEER_A_TO_B.id,
      amount: SENDER_LIQUIDITY
    }),
    {
      'A: sender liquidity funded': (r) => r.status === 200 || r.status === 202
    }
  );

  // ---- Node B (receiver) ----
  check(post(`${ADMIN_B_URL}/assets`, { code: 'USD', scale: 2 }), {
    'B: asset created or exists': createdOrExists
  });
  const receiverWalletRes = post(`${ADMIN_B_URL}/wallet-addresses`, {
    assetCode: 'USD',
    pathName: RECEIVER_PATH_NAME,
    publicName: 'Receiver (Node B)'
  });
  check(receiverWalletRes, {
    'B: receiver wallet created or exists': createdOrExists
  });
  const receiverWallet = safeJson(receiverWalletRes);
  check(
    post(`${ADMIN_B_URL}/peers`, {
      id: PEER_B_TO_A.id,
      name: 'Node A',
      assetCode: 'USD',
      assetScale: 2,
      ilpStaticAddress: PEER_B_TO_A.ilpStaticAddress,
      http: {
        outgoing: {
          endpoint: PEER_B_TO_A.endpoint,
          authToken: PEER_AUTH_TOKEN
        },
        incoming: { authToken: PEER_AUTH_TOKEN }
      }
    }),
    { 'B: peer-for-A created or exists': createdOrExists }
  );

  return {
    senderWalletAddress: senderWallet?.address,
    receiverWalletAddress: receiverWallet?.address
  };
}

export default function (data) {
  const intentRes = post(`${ADMIN_B_URL}/payment-intents`, {
    walletAddress: data.receiverWalletAddress,
    incomingAmount: INCOMING_AMOUNT
  });
  const intentOk = check(intentRes, {
    'intent created (B)': (r) => r.status === 201,
    'openPaymentsUrl returned (B)': (r) =>
      typeof safeJson(r)?.openPaymentsUrl === 'string'
  });
  if (!intentOk) return;
  const receiverIntentUrl = safeJson(intentRes).openPaymentsUrl;

  const quoteRes = post(`${ADMIN_A_URL}/quotes`, {
    walletAddress: data.senderWalletAddress,
    paymentIntentUrl: receiverIntentUrl,
    debitAmount: DEBIT_AMOUNT
  });
  const quoteOk = check(quoteRes, {
    'quote created (A)': (r) => r.status === 201
  });
  if (!quoteOk) return;
  const quote = safeJson(quoteRes);

  const paymentRes = post(`${ADMIN_A_URL}/payments`, {
    walletAddress: data.senderWalletAddress,
    paymentIntentId: quote.paymentIntentId,
    quoteId: quote.id
  });
  check(paymentRes, { 'payment created (A)': (r) => r.status === 201 });
}
