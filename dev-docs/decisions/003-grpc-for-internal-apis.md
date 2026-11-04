# 003: gRPC for internal APIs

**Status:** Accepted
**Date:** 2026-02

_Backfilled in October 2026. Based on the original rafiki-poc ideas from 2025._

## Context

Each bounded context exposes an internal API (`[bc]-api-service`) that other parts of the system call through a client (`[bc]-client-lib`). The main callers are the Open Payments and Admin API servers, which turn external requests into calls to the BCs. Commands and events go over Kafka ([001](001-kafka-for-commands-and-events.md)), but callers still need request/response calls for queries, and for actions where they wait for the result.

## Options considered

- **REST/JSON over HTTP, specified with OpenAPI**: rejected because JSON over HTTP/1.1 has larger payloads and more overhead per call than Protobuf over HTTP/2, on the hot paths between services.
- **Callers talk to the BC over Kafka directly, with no API service**: rejected because every caller would need its own Kafka producer, consumer and reply correlation, and eventually consistent reads gain nothing from a round trip through the broker.
- **gRPC**: chosen.

## Decision

Internal BC APIs use gRPC.

- The `.proto` files live in `[bc]-public-types-lib` and are the contract between the BC and its callers. TypeScript types and client stubs are generated from them.
- Each BC ships a `[bc]-client-lib` as the only way callers reach it. Today it wraps the generated gRPC client stub, but callers never see the transport: a client method could just as well publish a command to Kafka or use another protocol, without changing its callers.
- The gRPC APIs sit on both sides of the CQRS split in [001](001-kafka-for-commands-and-events.md): reads come straight from the BC's repositories, and most writes are published as commands to Kafka. Synchronous APIs then have to wait for the resulting event before responding. We should aim for more asynchronous APIs, which respond once the command is accepted and let the caller follow the outcome through events.
- External APIs (Open Payments and the Admin API) stay REST, specified with OpenAPI.

## Consequences

### Positive

- One typed contract per BC, with generated types and client stubs.
- Lower latency and smaller payloads than JSON over HTTP for service-to-service calls.

### Negative

- Two API styles in the system: gRPC internally, REST externally, with translation between them in the API servers.
- Harder to call by hand while debugging than a REST endpoint.
- Proto changes have to be versioned and released carefully with the client libraries.
