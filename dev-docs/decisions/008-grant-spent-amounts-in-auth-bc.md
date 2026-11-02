# 008: Store grant spent amounts in the Auth BC

**Status:** Accepted
**Date:** 2026-09-23
**Linear Issue:** RHY-150

## Context

Open Payments outgoing payment grants can carry `limits` (`debitAmount` or `receiveAmount`, optionally with a repeating `interval`). Rhyza needs to track how much has been spent under each grant so that:

- `POST /outgoing-payment` rejects a payment that would exceed the grant limit, or the limit for the current interval.
- `GET /outgoing-payment-grant` can return `spentDebitAmount` and `spentReceiveAmount`, in total or for the current interval.
- Concurrent create requests for the same grant cannot overspend, even with multiple `open-payments-resource-service` instances deployed.
- Amounts from failed or cancelled payments can be released back to the grant. Rafiki does not do this today, so it is an improvement, not a requirement.

The grant limits live in the Auth BC, but outgoing payments live in the Payments BC.

## Options considered

- **Payments BC**: build a spent amounts store from the Payments BC's own events. Rejected because the Payments BC would have to understand grant `interval` semantics, and concurrency would still need handling in the resource service.
- **`open-payments-resource-service`**: a Mongo collection of spent amounts with optimistic concurrency. The work week preference, since this is strictly an Open Payments feature. Rejected because the service would stop being stateless.
- **Auth BC**: chosen.

## Decision

Store spent amounts on the grant in the Auth BC.

- The grant holds its spent amounts: a running total, plus the current interval's total when the limits have an interval.
- The limit check is a command on the grant aggregate, keyed by grant id, that validates and updates the spent amounts in one step.
- `POST /outgoing-payment` gets both amounts from the quote (fetching it, or creating one if the request has no `quoteId`) before running the limit check.
- Failed or cancelled payments release their amount through an Auth BC event handler that consumes Payments BC events.

## Consequences

### Positive

- `open-payments-resource-service` stays stateless.
- The limit check runs next to the grant limits, in the same aggregate as the rest of the grant's state.
- Partitioning by grant id gives serialized updates without locking or retries.

### Negative

- The Auth BC now stores payment amount data whose only use is this Open Payments feature, and it must consume Payment BC domain events.
- When the request has no `quoteId`, a quote is created before the limit check. A request that will be rejected still pays for quoting, possibly over ILP.
- Payments must carry `grantId`.
