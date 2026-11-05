# 001: Kafka for commands and events between and within bounded contexts

**Status:** Accepted
**Date:** 2026-02

_Backfilled in October 2026. Based on the original rafiki-poc ideas from 2025._

## Context

Rafiki is a monolithic `backend` plus `auth` service on PostgreSQL. Scaling it means scaling the whole backend, and ordering and concurrency are handled with database locks. For example, creating outgoing payments under an outgoing payment grant takes a pessimistic lock on the grant, so concurrent requests cannot exceed the grant's spending limits. Every create request for that grant waits on the lock.

Rhyza is split into bounded contexts (Payments, ILP, PAL, Auth, Notifications) that need to:

- Communicate without calling each other's internals.
- Scale horizontally, by running more instances of a service.
- Process changes to the same entity (a payment intent, a grant, a ledger account) in order, without locking.
- Replay history for recovery and auditing, which the event-sourced ledger depends on.

## Options considered

- **Synchronous calls between services, with locking in the database**: closest to Rafiki. Rejected because ordering and concurrency would still rely on database locks, and services would be tightly coupled at runtime.
- **A traditional message queue (e.g. RabbitMQ)**: rejected because messages are not retained for replay, and there is no built-in partitioning. Competing consumers get messages round-robin, so commands for the same aggregate can be processed out of order or in parallel, which brings back locking.
- **Kafka**: chosen.

## Decision

Kafka is the messaging backbone for Rhyza. See `Kafka.md` for the details.

- Each bounded context has a `{bc}-commands` topic (internal) and a `{bc}-domain-events` topic (public, apart from private state and snapshot events).
- Most domain logic runs in a `{bc}-command-handler-service`, by consuming commands. Other BCs react to events through a `{bc}-event-handler-service`, which publishes commands.
- Messages are keyed by aggregate id.
- Writes and reads are separated (CQRS). Most writes go through commands, and reads go through each BC's `[bc]-api-service`, straight from its repositories ([003](003-grpc-for-internal-apis.md)). The PAL ledger is the full form, event-sourced with separate read-side projections.

## Consequences

### Positive

- Bounded contexts scale independently by adding partitions and consumers.
- Partitioning by aggregate id keeps consumers deterministic: the same consumer always handles a given aggregate, in order and without locks. This allows much more of the processing to happen in memory, instead of loading the aggregate from the database for every message.
- Event streams can be replayed for recovery and auditing.

### Negative

- Kafka is a significant piece of infrastructure for integrators to run and operate.
- Cross-BC flows are eventually consistent. Synchronous APIs have to wait for the resulting event, which is why some messages are keyed by `requestId` instead of aggregate id.
- Harder to debug and trace than in-process calls.
