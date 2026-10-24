# 001: Store grant spent amounts in the Auth BC

**Status:** Accepted
**Date:** 2026-09-23
**Linear:** RHY-150

## Context

Open Payments outgoing payment grants can carry `limits` (`debitAmount` or `receiveAmount`, optionally with a repeating `interval`). Rhyza needs to track how much has been spent under each grant so that:

- `POST /outgoing-payment` rejects a payment that would exceed the grant limit, or the limit for the current interval.
- `GET /outgoing-payment-grant` can return `spentDebitAmount` and `spentReceiveAmount`, in total or for the current interval.
- Concurrent create requests for the same grant cannot overspend, even with multiple `open-payments-resource-service` instances deployed.
- Amounts from failed or cancelled payments can be released back to the grant. Rafiki does not do this today, so it is an improvement, not a requirement.

The grant limits live in the Auth BC, but outgoing payments live in the Payments BC.

## Options considered

- **Auth BC**: the grant tracks its own spent amounts, and the limit check runs as a command on the grant aggregate.
- **Payments BC**: the Payments BC builds a spent amounts store from its own events, and `open-payments-resource-service` calls a new `paymentClient.getOutgoingPaymentSpentAmounts`. Rejected because the Payments BC would have to understand grant `interval` semantics, which have nothing to do with payments. Concurrency would still need handling in the resource service.
- **`open-payments-resource-service`**: a Mongo collection of spent amounts with optimistic concurrency (versioned records, retry on version mismatch), plus a Kafka consumer of Payments BC events to release failed amounts. This was the work week preference, since this is strictly an Open Payments feature. Rejected because the service would stop being stateless and would take on its own storage and event consumption.

## Decision

Store spent amounts on the grant in the Auth BC.

- `GrantEntity` holds `spentAmounts`: running `total` debit/receive, plus the current `interval` (start, end, totals) when the grant limits have an interval. When a payment falls past the tracked interval, the next interval is computed from the grant's repeating interval and its totals start again from zero.
- A new `ValidateOutgoingPaymentGrantLimitCmd`, keyed by grant id, validates and updates the spent amounts in one step. It emits `OutgoingPaymentGrantLimitValidatedEvent` or `OutgoingPaymentGrantLimitValidationFailedEvent`.
- Concurrency is handled by keying the command by grant id: all limit checks for a grant land on one partition and the `GrantAggregate` processes them in order. No optimistic or pessimistic locking is needed.
- `POST /outgoing-payment` flow:
  1. Generate `createdAt`.
  2. `authClient.introspectToken` without the limit check (signature, token validity, access).
  3. Get both amounts: `paymentClient.getQuote` if the request has a `quoteId`, otherwise `paymentClient.createQuote`.
  4. `authClient.validateOutgoingPaymentGrantLimit` with the quote's `debitAmount` and `receiveAmount`.
- `GET /outgoing-payment-grant` reads the spent amounts back from the grant via `authClient`.
- Release on failure: an Auth BC event handler consumes Payments BC events for failed or cancelled payments and sends a command, keyed by grant id, to subtract the amount from the total and, if still in that interval, from the interval total. This requires the Payments BC to store `grantId` on the payment.

## Consequences

### Positive

- `open-payments-resource-service` stays stateless.
- The limit check runs next to the grant limits, in the same aggregate as the rest of the grant's state.
- Partitioning by grant id gives serialized updates without locking or retries.

### Negative

- The Auth BC now stores payment amount data whose only use is this Open Payments feature.
- When the request has no `quoteId`, a quote is created before the limit check. A request that will be rejected still pays for quoting, possibly over ILP.
- Releasing amounts couples the Auth BC to Payments BC events, and payments must carry `grantId`.
