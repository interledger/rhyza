# 007: Opaque pagination cursors for Open Payments list actions

**Status:** Accepted
**Date:** 2026-09-22
**Linear Issue:** RHY-104

Related: [006: Opaque compound ids for Open Payments resources](006-opaque-compound-ids.md)

## Context

In Rafiki, a pagination cursor is the id of the boundary resource. It does not carry the query it came from. If a client reuses a cursor after changing the wallet address filter or sort order, it silently gets a page anchored to an unrelated position, and the server cannot tell the request is wrong.

This applies to the list endpoints in both the Open Payments and Admin APIs.

## Options considered

- **Plain id cursors, as in Rafiki**: rejected because of the wrong-page problem above.
- **Plain ids in Open Payments, encoded only behind it**: keeps the Open Payments cursor format unchanged. Rejected because encoding would move out of the Payments API, where it belongs, and the wrong-page problem would remain for Open Payments clients.
- **Opaque cursors carrying the query context**: chosen. Rafiki already intended base64 cursors, and the GraphQL Relay cursor spec, which Rafiki follows, calls for opaque cursors.

## Decision

Cursors are `base64url(JSON { id, ctx })`, where `ctx` is `sortOrder`, `walletAddressId` and `paymentIntentId` (`encodeCursor` in `payments-api-service`). `decodeCursor` throws `InvalidCursorError` if the context does not match the current request.

Like the compound ids in [006](006-opaque-compound-ids.md), cursors are opaque: clients pass them back exactly as received.

## Consequences

### Positive

- A cursor reused with different filters or sort order is rejected instead of returning the wrong page.
- The encoded content can change without changing the Open Payments API spec.

### Negative

- Clients that construct cursors themselves, instead of taking them from the previous page, now get an error.
