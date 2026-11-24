# Rhyza lite mode

**Status:** Draft
**Date:** 2026-11-24

## Intent

Rhyza takes a lot of resources to start. We want a way to run the full stack (every bounded context plus its infrastructure) in **at most 1GB of RAM at startup**, for local dev work and for lower-end servers. The current multi-service deployment, and with it the option to scale out horizontally later, has to keep working unchanged.

**Scope of this iteration: dev-only.** The lite image is built locally from the lite compose file and isn't released. Shipping it for servers is a follow-up, once measurement shows the 1GB budget holds (see Non-goals).

## Measured baseline

Measured 2026-11-24 on a MacBook (arm64), each piece idle right after startup, no load:

| Piece                                                                                                 | Idle RAM         |
| ----------------------------------------------------------------------------------------------------- | ---------------- |
| One Node service (`payments-command-handler-service`, native `node dist/index.js`)                    | ~91MB RSS        |
| 21 Node services (extrapolated from the one above)                                                    | ~1.9GB           |
| Kafka (`apache/kafka:4.0.0`, no heap options set, so the image default of about 1GB max heap applies) | ~350MB, can grow |
| MongoDB 7 (default WiredTiger cache, which is about half the machine's RAM)                           | ~125MB, can grow |
| Valkey 9                                                                                              | ~5MB             |

That's about 2.4GB idle. The Node services alone are close to twice the budget, so swapping Kafka by itself can't hit the target.

`pnpm docker:up` also enables the `with-observability` profile (Grafana, Prometheus, Tempo, OTel collector, nginx, Redpanda Console). That profile isn't part of the numbers above and isn't part of the 1GB budget.

## Goals

- The full lite stack (all bounded contexts, Kafka, MongoDB, Valkey), idle after startup, uses 1GB or less in total, measured as the sum of `docker stats` memory across its containers.
- Lite mode runs the same code paths as the distributed deployment. Services still talk to each other over Kafka and gRPC, with the same topics, keys and partitions.
- Existing per-service images, `docker/docker-compose.yaml` and the e2e setup keep working unchanged.
- The runner can be told which services to start, so the same image can later run a subset (for example one bounded context per process) as a step towards scaling out.

## Non-goals

- Releasing the lite image in this iteration. That means no changes to `docker-build.yaml` or `release.yaml`, no multi-arch builds, no restricting the default service list to `.github/release-packages.json`, and no making secrets or public URLs configurable beyond what compose already does. The follow-up for servers would need all of those, and would turn `ase-mock-service` and `http-signature-service` off by default.
- Replacing Kafka or changing the messaging interfaces in `common-types-lib`. Approaches B and C below are deferred until we've measured A.
- Changes to domain logic, topics, message keys or partitioning.
- Throughput or latency tuning under load.
- Fitting the observability profile into the budget.

## Anti-goals

- Lite mode drifting from distributed mode in behavior, for example in-process shortcuts that bypass Kafka or gRPC. A bug that only shows up in one mode would defeat the point.
- Having to edit every service's business code to make this work.

## Minimal changes to existing code

This is a hard requirement. Lite mode should be almost entirely new files: a new package, a new compose file and a new Dockerfile. The only existing files this iteration touches:

- Root `package.json`: new `lite:*` scripts.
- `docs/src/content/docs/testlocal.mdx`: a new section.
- `packages/tests-e2e`: optional env-var parameters whose defaults match today's hardcoded values (section 6).

No changes to existing services, the shared libs (`implementations-lib`, `common-types-lib`, the `*-domain-lib` and `*-implementations-lib` packages), `docker-compose.yaml` or CI workflows. If the builder finds that something can't work without touching one of those, they stop and raise it instead of making the change.

## Constraints found in the code

- Every service under `packages/*-service` exports a class with `static async start()` and `static async stop()` from `src/service.ts`. `src/index.ts` only calls `start()`, installs SIGINT/SIGTERM handlers, and calls `process.exit(999)` on `uncaughtException`. A runner can import `service.ts` and skip `index.ts`.
- Config is read from `process.env` at module load time (top-level `const`s in `service.ts`), and services share variable names.
  - `PORT` and `HOST` are used by six HTTP services, each with a different default: admin-api 3001, ase-mock 3000, http-signature 3010, idp-interaction 3004, open-payments-auth 3003, open-payments-resource 3002. In `docker-compose.yaml` only http-signature and ase-mock set them, and their `HOST` values are container hostnames.
  - gRPC ports are distinct (50051 to 50054). The ILP connector uses `ILP_CONNECTOR_HTTP_PORT` (4000 in compose).
  - Names are inconsistent: PAL services read `MONGO_URL`, others read `MONGODB_URL`. `KAFKA_URL` defaults differ (9092, 9093, 29092), but compose always sets it.
- The three PAL services call `OpenTelemetryService.Start(...)` (a global `NodeSDK`, a tracer provider and instrumentations) unless a `telemetryService` is passed to `start()`. Doing that three times in one process would register global providers three times.
- Each service builds its own `KafkaBuilder` producer and consumer (librdkafka, with native threads and buffers per client) and its own MongoDB client.
- `MessageSerializationFactory.instance()` (`implementations-lib/src/serde/message-serialization-factory.ts`) is a process-wide singleton, and `register()` throws when a serde for the same format, type and name already exists. pal-api, pal-event-handler and pal-ledger-command-handler register the same ledger serdes, so in one process the second PAL service's `start()` throws. All three PAL `start()` methods accept a `msgSerializationFactory` and skip registration when one is passed. When it's passed, pal-event-handler and pal-ledger-command-handler also skip `setTelemetry()` on it. pal-api registers only the commands, a subset of what the other two register.
- `tests-e2e` waits for the log line `AdminApiService start complete` on container `admin-api-service-1`; that line comes from admin's `index.ts`, which the runner skips. It also peers the two nodes by hostname (`ilp-connector-service:4000`) and hardcodes the compose files.
- `ase-mock-service` approves each payment when it gets the `PaymentCreated` webhook (`WEBHOOK_URL` points at it), and the e2e suite relies on that. Without it, payments don't complete.
- `init-kafka` runs a second JVM (the Kafka image) at startup just to create topics.
- Building `open-payments-resource-service` needs the `open-payments-specifications` submodule checked out.

## Approaches

- **A. All services in one Node process, with Kafka and MongoDB memory capped.** No messaging or domain changes. Estimated total 0.7 to 0.9GB, not yet measured. Scaling out is unchanged: deploy the per-service images as today. **Chosen.**
- **B. A, plus a lighter Kafka-compatible broker (for example Redpanda).** No code changes. It's not clear it beats a heap-capped Kafka at this size. Revisit only if A comes in over budget.
- **C. A, plus a built-in non-Kafka broker for lite mode.** Saves roughly 300MB more, but needs a second implementation of `IMessageProducer`, `IMessageConsumer` and `IMessageFetcher`. That includes per-key ordering and the partition and offset replay the PAL ledger's event store (`KafkaLedgerEventSourcingRepository`, `KafkaFetcher`) depends on. An in-memory version isn't durable, so it's unusable on servers. Rejected for now.
- One process per bounded context (5 processes) was dropped: about 500MB of Node plus infra is too tight.

## Design

### 1. Lite runner package

A new package, `packages/rhyza-lite-service`, which is one Node entrypoint that:

1. Reads `RHYZA_SERVICES`, a comma-separated list of service package names. It defaults to every service, `ase-mock-service` included: without it payments never get approved and e2e can't pass. The mock runs in the same process and counts toward the 1GB.
2. Creates the Kafka topics with the existing `KafkaAdmin` (`implementations-lib/src/kafka/kafka-admin.ts`), using the same topics and partition counts as `init-kafka` (3 partitions; `audits` and `logs` use the default). This replaces the `init-kafka` JVM in lite mode. (My call; see section 4 for the topic-list duplication.)
3. Starts the selected services in dependency order: gRPC API services first (pal, payments, ilp, auth), then command handlers, then event handlers, then the HTTP edge services (admin, open-payments, idp, http-signature, ilp-connector, ase-mock). Each one is awaited before the next starts.
4. Registers the PAL serdes once on `MessageSerializationFactory.instance()`: snapshot, state events and commands, which is the superset pal-event-handler and pal-ledger-command-handler use. It calls `setTelemetry()` on the factory, then passes that factory into all three PAL services' `start()`, so they skip their own registration. This needs no change to `implementations-lib` or the PAL services. (Builder-check finding.)
5. Logs `Rhyza lite start complete` once every selected service has started, so tooling has a single readiness signal.
6. Installs one SIGINT/SIGTERM handler that calls `stop()` on started services in reverse order, with the same 5s force-exit timeout `index.ts` uses today. It keeps the existing `uncaughtException` behavior (exit), which in lite mode takes down the whole process. That's acceptable: a container restart policy brings it back.

### 2. Configuration

- Lite mode sets only variables that have one value across all services (`KAFKA_URL`, `MONGODB_URL` and `MONGO_URL`, `REDIS_URL`, the gRPC URLs pointing at `localhost`, `ILP_ADDRESS`, `LOG_LEVEL`, and so on).
- `PORT` and `HOST` are left unset, so each HTTP service binds `0.0.0.0` on its own distinct default port.
- If a variable genuinely needs different values per service, the runner handles it without touching the service. Config is read when the module loads, so the runner sets that service's values in `process.env`, then dynamically `import()`s its `service.ts`, then restores the env before moving to the next service. Use this only where it's needed; I expect few or no such cases.

### 3. Telemetry

The runner creates the telemetry service at most once and passes it into the PAL services' `start(..., telemetryService)`, which they already accept. When `OPEN_TELEMETRY_COLLECTOR_URL` isn't set in lite mode, the runner should pass a no-op `ITelemetryService` if loading the OTel SDK turns out to cost a meaningful share of the budget (builder measures and decides).

### 4. Lite compose and infra caps

A new `docker/docker-compose.lite.yaml`, separate from `docker-compose.yaml`:

- `rhyza-lite`: built from `packages/rhyza-lite-service/Dockerfile`, which follows the existing Dockerfile pattern (`pnpm deploy --prod`) and includes every service package. Exposes the same host ports as the distributed stack.
- `kafka`: same image and listener config as today, plus `KAFKA_HEAP_OPTS: "-Xmx256m -Xms256m"` (starting value; raise if it's unstable).
- `mongodb`: `--wiredTigerCacheSizeGB 0.25`.
- `redis` (Valkey): unchanged.
- No `init-kafka` (the runner creates topics) and no observability services.
- A `mem_limit` on each container as a safety ceiling, set above that container's measured working set so normal growth (PAL caches, Kafka off-heap) doesn't get it OOM-killed. The limits enforce bounded growth, not the 1GB budget; the budget is checked by measurement (section 6). (My call.)

The topic list then lives in two places: the runner, and the untouched `init-kafka` script in `docker-compose.yaml`. The runner's copy gets a comment pointing at `init-kafka` as the source to keep in sync. Deduplicating would mean editing `docker-compose.yaml`, so it's out of scope.

Root `package.json` gets `lite:up`, `lite:down` and `lite:build` scripts mirroring the `docker:*` ones, without `--profile with-observability`.

### 5. Getting under budget

Measure after steps 1 to 4. If the total is still over 1GB, apply these in order and re-measure after each:

1. Pass a no-op `ITelemetryService` (section 3).
2. Cap Node's heap (`--max-old-space-size`) on the runner. The value is the builder's call, based on measured peak.
3. Lower the Kafka heap and the Mongo cache, as long as the e2e suite still passes.
4. If it's still over, stop and come back with the numbers. The next options are sharing Mongo and Kafka clients across services (which would mean editing services' `start()`, so it needs sign-off under the minimal-changes rule) or approach B.

### 6. Verification

- A documented check: `pnpm lite:up`, wait for the services to be healthy, then sum `docker stats --no-stream` memory across the lite containers. It has to be 1GB or less. Report Kafka, MongoDB, Valkey and the runner separately.
- The memory numbers come from `docker stats` on the Linux containers (Docker Desktop's VM counts), not from native processes on macOS. (My call.)
- Behavior parity: run the existing e2e suite (`packages/tests-e2e`) against lite mode. The e2e stack today combines `docker-compose.yaml` and `docker-compose.node-b.yaml` (two Rhyza nodes peering). The minimum is node A in lite mode peering with a full node B. Both nodes in lite mode is better, if it's cheap.
- To make that possible, `tests-e2e` reads optional env vars for the compose files, readiness container and log line, and the peer connector hostname. The defaults are today's hardcoded values, so with nothing set it behaves exactly as today. Keep the diff to those reads. (My call; this is the one existing package that changes.)
- For now this is a documented manual check, not a CI job. Adding a lite e2e job to `e2e.yaml` or `release.yaml` is a follow-up. (My call.)
- The existing `pnpm docker:up` and `pnpm e2e` keep passing unchanged.

### 7. Docs

Add a "Lite mode" section to `docs/src/content/docs/testlocal.mdx`: what it is, the commands, the memory numbers, and that it's the same code as the distributed deployment.

## Left to the builder

- Exact service start order within each group, and readiness checks between groups if needed.
- Kafka heap and Node heap values, based on measurement.
- Whether the no-op telemetry and the Node heap cap are needed (section 5).

## Risks and unknowns

- The combined Node process estimate (250 to 400MB) isn't measured. Each service still holds its own librdkafka clients and Mongo pool.
- The PAL ledger command handler keeps aggregates and snapshot caches in memory, so its footprint may grow with data even when idle.
- Kafka with a 256MB heap and about 19 topics of 3 partitions each hasn't been tested.
- Static class state in each service is per class, so it doesn't collide between services. Process-wide singletons do: the serde factory collision is known and handled without code changes (section 1). Other singletons and module-level side effects at import time haven't been audited; the builder should check for more. If one can't be handled from the runner, that's a stop-and-raise under the minimal-changes rule.
- Without shared clients, about 21 sets of Kafka and Mongo clients live in one process. That's the main reason the Node estimate could miss.
