# API Changelog 0.0.0 vs. 0.0.1

## API Changes

### POST /assets

- api operation id `Assets_createAsset` removed and replaced with `createAsset`

### POST /payment-intents

- api operation id `PaymentIntents_createPaymentIntent` removed and replaced with `createPaymentIntent`

### GET /payment-intents/{id}

- :warning: added the new `COMPLETED` enum value to the `state` response property for the response status `200`
- :warning: added the new `CREATED` enum value to the `state` response property for the response status `200`
- api operation id `PaymentIntents_getPaymentIntent` removed and replaced with `getPaymentIntent`

### POST /payment-intents/{id}/complete

- api operation id `PaymentIntents_completePaymentIntent` removed and replaced with `completePaymentIntent`

### GET /payment-intents/{intentId}/payments/{id}

- :warning: added the new `CANCELLED` enum value to the `state` response property for the response status `200`
- :warning: added the new `COMPLETED` enum value to the `state` response property for the response status `200`
- :warning: added the new `CONFIRMED` enum value to the `state` response property for the response status `200`
- :warning: added the new `CREATED` enum value to the `state` response property for the response status `200`
- :warning: added the new `FAILED` enum value to the `state` response property for the response status `200`
- :warning: added the new `PROCESSING` enum value to the `state` response property for the response status `200`
- :warning: added the new `REJECTED` enum value to the `state` response property for the response status `200`
- :warning: added the new `SENDING` enum value to the `state` response property for the response status `200`
- api operation id `Payments_getPayment` removed and replaced with `getPayment`

### POST /payment-intents/{intentId}/payments/{id}/approve

- :warning: added the new `CANCELLED` enum value to the `state` response property for the response status `200`
- :warning: added the new `CONFIRMED` enum value to the `state` response property for the response status `200`
- :warning: added the new `CREATED` enum value to the `state` response property for the response status `200`
- :warning: added the new `PROCESSING` enum value to the `state` response property for the response status `200`
- :warning: added the new `REJECTED` enum value to the `state` response property for the response status `200`
- :warning: added the new `SENDING` enum value to the `state` response property for the response status `200`
- api operation id `Payments_approvePayment` removed and replaced with `approvePayment`

### POST /payment-intents/{intentId}/payments/{id}/cancel

- :warning: request body became required
- api operation id `Payments_cancelPayment` removed and replaced with `cancelPayment`

### POST /payments

- api operation id `Payments_createPayment` removed and replaced with `createPayment`

### POST /peers

- api operation id `Peers_createPeer` removed and replaced with `createPeer`

### POST /quotes

- api operation id `Quotes_createQuote` removed and replaced with `createQuote`

### POST /wallet-addresses

- api operation id `WalletAddresses_createWalletAddress` removed and replaced with `createWalletAddress`

## Info

- a breaking change was detected but the major version did not increase, from `0.0.0` to `0.0.1`
