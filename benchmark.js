/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-undef */

import http from 'k6/http';
import { check } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { sleep } from 'k6';

export const options = {
  scenarios: {
    contacts: {
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

const ADMIN_API_URL = 'http://localhost:3001';
const RECEIVER_WALLET_ADDRESS = 'test.com/receiver';
const SENDER_WALLET_ADDRESS = 'test.com/sender';

function request(url, data) {
  return http.post(url, JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

export function setup() {
  const assetRes = request(`${ADMIN_API_URL}/assets`, {
    code: 'USD',
    scale: 2
  });
  // 409 already exists OK for reruns
  check(assetRes, {
    'asset created or exists': (r) => r.status === 201 || r.status === 409
  });

  const receiverRes = request(`${ADMIN_API_URL}/wallet-addresses`, {
    address: RECEIVER_WALLET_ADDRESS,
    publicName: 'Receiver',
    assetCode: 'USD'
  });
  check(receiverRes, {
    'receiver wallet created or exists': (r) =>
      r.status === 201 || r.status === 409
  });
  const receiver = JSON.parse(receiverRes.body);

  const senderRes = request(`${ADMIN_API_URL}/wallet-addresses`, {
    address: SENDER_WALLET_ADDRESS,
    publicName: 'Sender',
    assetCode: 'USD'
  });
  check(senderRes, {
    'sender wallet created or exists': (r) =>
      r.status === 201 || r.status === 409
  });
  const sender = JSON.parse(senderRes.body);

  return {
    receiverWalletAddress: receiver.address || RECEIVER_WALLET_ADDRESS,
    senderWalletAddress: sender.address || SENDER_WALLET_ADDRESS
  };
}

export default function (data) {
  const paymentIntentId = uuidv4();
  const paymentIntentRes = request(`${ADMIN_API_URL}/payment-intents`, {
    id: paymentIntentId,
    walletAddress: data.receiverWalletAddress
  });

  console.log(`payment intent response: ${paymentIntentRes.body}`);

  check(paymentIntentRes, {
    'payment intent created': (r) => r.status === 201,
    'payment intent id matches': (r) =>
      JSON.parse(r.body).id === paymentIntentId
  });

  const quoteRes = request(`${ADMIN_API_URL}/quotes`, {
    walletAddress: data.senderWalletAddress,
    paymentIntentId,
    debitAmount: '100'
  });

  console.log(`quote response: ${quoteRes.body}`);

  check(quoteRes, {
    'quote created': (r) => r.status === 201
  });

  const quoteBody = JSON.parse(quoteRes.body);
  const quoteId = quoteBody.id;
  const quotePaymentIntentId = quoteBody.paymentIntentId;

  const paymentRes = request(`${ADMIN_API_URL}/payments`, {
    walletAddress: data.senderWalletAddress,
    paymentIntentId: quotePaymentIntentId,
    quoteId
  });

  console.log(`payment response: ${paymentRes.body}`);

  check(paymentRes, {
    'payment created': (r) => r.status === 201
  });
}
