# 005: A single REST Admin API

**Status:** Accepted
**Date:** 2026-02

_Backfilled in October 2026. Based on the original rafiki-poc ideas from 2025._

## Context

Rafiki has two separate GraphQL Admin APIs, one for `backend` and one for `auth`. Integrators (ASEs) use the Admin API to manage assets, wallet addresses, peers, payments and grants, and it is usually their first integration with Rafiki.

Most integrators are more familiar with REST, GraphQL needs its own client tooling, and generating typed SDKs for many languages is less mature than for OpenAPI. Having two APIs also means two schemas, two sets of docs and two endpoints to configure.

## Options considered

- **Keep GraphQL, as in Rafiki**: rejected because of the onboarding and tooling cost for integrators.
- **One REST Admin API per bounded context**: rejected because integrators would have to deal with several APIs, as with Rafiki's `backend` and `auth` split.
- **A single REST Admin API, specified with OpenAPI**: chosen.

## Decision

Rhyza has one REST Admin API (`admin-api-service`) covering all admin functionality.

- The service is a stateless layer that translates requests into calls to the bounded contexts' internal gRPC APIs ([003](003-grpc-for-internal-apis.md)).
- The OpenAPI spec is the contract. Admin API SDKs are generated from it (`admin-client-lib` uses OpenAPI Generator).

## Consequences

### Positive

- Easier onboarding for integrators: REST is familiar and can be called with any HTTP client.
- Standard OpenAPI tooling for integrators, including documentation.
- Admin API SDKs can be generated for many languages from the same spec, instead of being hand-written.
- One API, one spec and one endpoint for integrators to configure.

### Negative

- Integrators migrating from Rafiki have to rewrite their Admin API integration.
- Clients cannot choose which fields to fetch, so some responses carry more data than needed, and related data may need extra requests.
- The single API spans every bounded context, so it changes whenever any of them does and needs careful versioning.
