# 002: MongoDB as the default database

**Status:** Accepted
**Date:** 2026-02

_Backfilled in October 2026. Based on the original rafiki-poc ideas from 2025._

## Context

Rafiki uses PostgreSQL. In Rhyza, state is owned by aggregates (see [001](001-kafka-for-commands-and-events.md)): each aggregate is loaded, changed by a batch of commands and flushed back as a unit. Child resources live inside their aggregate, for example quotes and payments inside a payment intent. The datastore needs high write throughput and horizontal scaling.

## Options considered

- **PostgreSQL, as in Rafiki**: rejected as the default because aggregates map less naturally to relational tables, and scaling writes horizontally is harder.
- **MongoDB**: chosen.

## Decision

MongoDB is the default datastore for every bounded context.

- Repository interfaces live in `[bc]-domain-lib`, and MongoDB implementations live in `[bc]-implementations-lib`. Domain code never depends on MongoDB directly.
- An alternative implementation (e.g. PostgreSQL) can be added behind the same repository interfaces if required.

## Consequences

### Positive

- An aggregate is stored and fetched as one document, matching how the domain loads and flushes it.
- High write throughput and native horizontal scaling (sharding).
- Simpler migration management. There is no schema to migrate, so additive changes (a new optional field, such as `spentAmounts` on a grant) need no migration at all, and there is no migration framework to run on deploy as with Rafiki's Knex migrations.

### Negative

- No foreign keys or cross-document transactions by default. Invariants the database would otherwise enforce (uniqueness across aggregates, references to other entities, valid state transitions) have to be enforced in the business logic itself: in entities, aggregates and domain services. Consistency across aggregates relies on that logic together with Kafka ordering and the command flow, not on the database.
- Integrators migrating from Rafiki move from PostgreSQL to MongoDB, with different operational knowledge needed.
- Without a schema, nothing enforces document shape. Changes that rename, remove or restructure fields require code that tolerates both shapes.
