# Lite mode: ASE mock as a separate container

**Status:** Draft
**Date:** 2026-11-24
**Builds on:** `2026-11-24-lite-mode-design.md`

## Intent

Make it easy for ASEs to run Rhyza lite. An ASE has its own webhook endpoint and doesn't need `ase-mock-service`, so the mock shouldn't be inside the lite image. Dev and e2e still need it, so it moves to its own optional container.

## Goals

- `rhyza-lite-service` no longer contains or starts `ase-mock-service`.
- An ASE runs the lite compose without the mock and points `WEBHOOK_URL` at their own endpoint.
- `pnpm lite:up` and the lite e2e still run the mock, and the e2e suite still passes on two lite nodes.

## Non-goals

- Releasing the lite image (same as the lite spec).
- Changes to `ase-mock-service`, its Dockerfile, `docker-compose.yaml` or `docker-compose.node-b.yaml`.

## Approaches

- **A. Always-on mock container in the lite compose.** Simplest, but an ASE gets the mock unless they edit the file. Works against the intent.
- **B. Mock container behind a compose profile `with-ase-mock`.** Same pattern as `with-observability`. **Chosen.**
- **C. Separate overlay compose file.** Same result as B, but one more file and two `-f` flags on every command.

## Design

### Runner

- Remove `ase-mock-service` from `SERVICE_START_ORDER`, `registry.ts`, the package's `package.json` dependencies (and the lockfile), and the lite Dockerfile if it references it. Fix tests that count or list services.
- With the mock gone, `RHYZA_SERVICES=ase-mock-service` is an unknown name and gets rejected like any other.
- Docs and comments that say "21 services" become 20.

### Node A (`docker-compose.lite.yaml`)

- `rhyza-lite`: drop the `ase-mock-service` alias and port `3000`. `WEBHOOK_URL: ${WEBHOOK_URL:-http://ase-mock-service:3000/webhooks}`.
- New `ase-mock-service` under `profiles: [with-ase-mock]`, built from `packages/ase-mock-service/Dockerfile` with a fixed image name so node B can reuse it, the same way `rhyza-lite-service` does today. `ADMIN_URL: http://admin-api-service:3001` (it resolves through the `rhyza-lite` alias), `PORT: 3000`, `HOST` unset (binds `0.0.0.0`), port `3000:3000`, `depends_on: rhyza-lite`, and a `mem_limit` safety ceiling.
- Define it inline instead of `extends`. The base definition depends on `admin-api-service`, and that service doesn't exist in the lite file. (My call; the builder can switch to `extends` with an override if compose doesn't carry `depends_on` over.)

### Node B (`docker-compose.lite.node-b.yaml`)

- Same treatment: `ase-mock-service-b` under the same profile, reusing the image with `pull_policy: never`, `ADMIN_URL: http://admin-api-service-b:3001`, port `4300:3000`. Drop the alias and port from `rhyza-lite-b`, and remove `ase-mock-service` from its `RHYZA_SERVICES` list.
- Node B's webhook reads `${WEBHOOK_URL_B:-http://ase-mock-service-b:3000/webhooks}`, not `WEBHOOK_URL`. The e2e suite sets `WEBHOOK_URL` to node A's mock for compose interpolation, so sharing the variable would point node B at node A's mock.

### Scripts and e2e

- `lite:build`, `lite:up`, `lite:stop` and `lite:down` pass `--profile with-ase-mock`. That's the dev stack. An ASE runs `docker compose -f docker/docker-compose.lite.yaml up` without it.
- Lite e2e: the documented command adds `COMPOSE_PROFILES=with-ase-mock`, and the build step passes `--profile with-ase-mock`. The aim is no change to `tests-e2e`. If testcontainers doesn't pass `COMPOSE_PROFILES` through to compose, fall back to an optional `E2E_COMPOSE_PROFILES` read in `tests-e2e`, with no profiles by default.

### Memory

- The mock container counts toward the 1 GiB budget that `lite:mem` checks. It's expected to add about 50 to 90 MiB to the measured 500 to 535 MiB. Re-measure and update the docs table.

### Docs

- `testlocal.mdx`: the mock is a separate container under `with-ase-mock`, a short "Running lite as an ASE" note (skip the profile, set `WEBHOOK_URL`, approve payments through the admin API), the updated memory table, and the updated e2e command.
- Amend the lite spec where it says the mock runs in-process.

## Left to the builder

- The mock's `mem_limit` value, based on measurement.
- Whether `COMPOSE_PROFILES` passes through testcontainers, or the `tests-e2e` fallback is needed.

## Risks

- If an ASE forgets to set `WEBHOOK_URL`, it defaults to a mock that isn't running. Webhook delivery fails and retries, and payments stay unapproved. The docs call this out.
