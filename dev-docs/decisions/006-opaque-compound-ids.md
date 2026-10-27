# 006: Opaque compound ids for Open Payments resources

**Status:** Accepted
**Date:** 2026-08-21
**Linear Issue:** RHY-120

Related: [007: Opaque pagination cursors](007-opaque-pagination-cursors.md)

## Context

In Rafiki, ids returned by the Open Payments APIs are the underlying database UUIDs. In Rhyza, a child id alone is not enough to find the resource:

- Quotes and payments are child resources stored inside their payment intent. The Payments BC fetches them by parent and child id (e.g. `GetQuoteRequest` and `GetPaymentRequest` in `payments-svc.proto` both require `payment_intent_id`).
- Grant operations (continue, token rotation and revocation) are commands handled by the `GrantAggregate`, keyed by grant id. A continue id or token management id alone does not identify which grant to load.
- Open Payments URLs (`/outgoing-payments/{id}`, `/quotes/{id}`, `/continue/{id}`, `/token/{id}`) carry a single id, and the spec cannot change.

## Options considered

- **Plain child ids plus a lookup**: keep UUIDs and resolve the parent through an index from child id to parent id. Rejected because every request would need an extra read before reaching the aggregate.
- **Parent id encoded in the public id**: chosen.

## Decision

Open Payments returns compound ids: `base64url(parentId + "_" + childId)`.

- Resource server: `paymentIntentId` + quote or payment id (`encodeCompoundId` in `open-payments-resource-service`).
- Auth server: `grantId` + continue id, access token value, or token management id (`encodeCompoundId` in `open-payments-auth-service`).
- A value that does not decode to two parts returns `404`.

Clients must treat every identifier Rhyza returns as opaque, even ones that look like UUIDs. What is encoded inside is internal and may change. This is documented under "Opaque Identifiers" in `Architectural Differences from Rafiki.md`, which also covers the cursors in [007](007-opaque-pagination-cursors.md).

## Consequences

### Positive

- Every Open Payments request reaches the right aggregate directly (with the correct partitioning in the Kafka topic), with no extra lookup.
- The encoded content can change without changing the Open Payments API spec.

### Negative

- Ids are no longer UUIDs. Integrations that store or validate them as UUIDs (for example the test wallet and Interledger Boutique) have to change.
- The `_` delimiter assumes neither encoded id contains `_`.
