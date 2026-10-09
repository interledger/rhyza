# API Changelog 0.0.9 vs. 0.0.10

## API Changes

### GET /assets
-  endpoint added

# API Changelog 0.0.8 vs. 0.0.9

## API Changes

### POST /payment-intents
- :warning: the `metadata` request property `type` changed from `string` to `object`


### POST /payments
-  added the new optional request property `metadata`

## Info
-  a breaking change was detected but the major version did not increase, from `0.0.8` to `0.0.9`

# API Changelog 0.0.7 vs. 0.0.8

## API Changes

### POST /rates
-  endpoint added

# API Changelog 0.0.6 vs. 0.0.7

## API Changes

### POST /wallet-addresses/{id}/activate

- endpoint added

# API Changelog 0.0.5 vs. 0.0.6

## API Changes

### POST /wallet-addresses/{id}/deactivate

- endpoint added

# API Changelog 0.0.4 vs. 0.0.5

## API Changes

### POST /liquidity/deposit

- :warning: added the new required request property `amountScale`
- :warning: removed the success response with the status `202`
- added the success response with the status `200`

## Info

- a breaking change was detected but the major version did not increase, from `0.0.4` to `0.0.5`
-

# API Changelog 0.0.3 vs. 0.0.4

## API Changes

### POST /wallet-addresses/{id}/keys/{keyId}/revoke

- endpoint added

# API Changelog 0.0.2 vs. 0.0.3

## API Changes

### POST /wallet-addresses

- added the required property `id` to the response with the `201` status

### POST /wallet-addresses/{id}/keys

- endpoint added

# API Changelog 0.0.1 vs. 0.0.2

## API Changes

### GET /payment-intents

- endpoint added

### GET /payment-intents/{id}

- added the required property `createdAt` to the response with the `200` status

### GET /payment-intents/{intentId}/payments/{id}

- :warning: the `debitAmount` response's property `type` changed from `string` to `object` for status `200`
- :warning: the `receiveAmount` response's property `type` changed from `string` to `object` for status `200`
- :warning: the `sentAmount` response's property `type` changed from `string` to `object` for status `200`
- :warning: removed the required property `assetCode` from the response with the `200` status
- :warning: removed the required property `assetScale` from the response with the `200` status
- added the optional property `failReason` to the response with the `200` status
- added the required property `createdAt` to the response with the `200` status
- added the required property `debitAmount/assetCode` to the response with the `200` status
- added the required property `debitAmount/assetScale` to the response with the `200` status
- added the required property `debitAmount/value` to the response with the `200` status
- added the required property `paymentIntentId` to the response with the `200` status
- added the required property `receiveAmount/assetCode` to the response with the `200` status
- added the required property `receiveAmount/assetScale` to the response with the `200` status
- added the required property `receiveAmount/value` to the response with the `200` status
- added the required property `sentAmount/assetCode` to the response with the `200` status
- added the required property `sentAmount/assetScale` to the response with the `200` status
- added the required property `sentAmount/value` to the response with the `200` status

### GET /payments

- endpoint added

## Info

- a breaking change was detected but the major version did not increase, from `0.0.1` to `0.0.2`

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

# API Changelog 0.0.1 vs. 0.1.0

## API Changes

### POST /liquidity/deposit

- :warning: added the new required request property `amountScale`
- :warning: removed the success response with the status `202`
- added the success response with the status `200`
