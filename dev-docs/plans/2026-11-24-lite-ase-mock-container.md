# Lite ASE mock container Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `ase-mock-service` out of the lite runner into its own optional container, so ASEs run Rhyza lite with their own webhook.

**Architecture:** The runner drops the mock entirely, leaving 20 services. Both lite compose files gain a mock container under the `with-ase-mock` profile, built once from the existing `packages/ase-mock-service/Dockerfile`. `WEBHOOK_URL` (node A) and `WEBHOOK_URL_B` (node B) become overridable, and the defaults point at the mocks. The `lite:*` scripts and the lite e2e command turn the profile on.

**Tech Stack:** TypeScript, node:test via tsx, pnpm workspaces, Docker Compose profiles, testcontainers 12.1.0.

**Spec:** `dev-docs/specs/2026-11-24-lite-ase-mock-container-design.md` (builds on `dev-docs/specs/2026-11-24-lite-mode-design.md`)

## Global Constraints

- No changes to `packages/ase-mock-service`, `docker/docker-compose.yaml`, `docker/docker-compose.node-b.yaml`, CI workflows, or any service or shared lib.
- No changes to `packages/tests-e2e` (testcontainers 12.1.0 spreads `process.env` into the compose env in `default-compose-options.js`, so `COMPOSE_PROFILES` passes through).
- Profile name: `with-ase-mock`. Mock image name: `rhyza-lite-ase-mock`.
- Node A: `WEBHOOK_URL: ${WEBHOOK_URL:-http://ase-mock-service:3000/webhooks}`. Node B: `WEBHOOK_URL: ${WEBHOOK_URL_B:-http://ase-mock-service-b:3000/webhooks}`.
- The 1 GiB budget (`lite:mem`) includes the mock container.
- Commit messages: `type(lite): ...` as in the existing branch history, with no Claude co-author trailer. No em-dashes anywhere.

## Review Focus

1. ASE run without the profile: `docker compose -f docker/docker-compose.lite.yaml` lists no mock service, and nothing binds host port 3000. (Task 2, Step 2)
2. ASE sets `WEBHOOK_URL`: the value reaches `rhyza-lite`'s environment. (Task 2, Step 2)
3. The e2e suite exports `WEBHOOK_URL=http://ase-mock-service:3000/webhooks`: node B must still get `ase-mock-service-b`. (Task 2, Step 2)
4. Node B's mock uses `pull_policy: never`, so building without the profile leaves the image missing and node B fails to start. The build commands must include the profile. (Task 2, Step 4; Task 3, Step 1)
5. `lite:down` with the mock running has to remove the mock container too, so the next `lite:up` doesn't hit a stale container or a port conflict. (Task 2, Step 5)

---

### Task 1: Remove the mock from the runner

**Files:**

- Modify: `packages/rhyza-lite-service/src/service-names.ts` (drop `'ase-mock-service'`)
- Modify: `packages/rhyza-lite-service/src/registry.ts` (drop the `MockWebhookIntegrationService` import and its entry)
- Modify: `packages/rhyza-lite-service/package.json` (drop the `ase-mock-service` dependency)
- Modify: `pnpm-lock.yaml` (via `pnpm install`)
- Modify: `packages/rhyza-lite-service/README.md` ("21" becomes "20")
- Test: `packages/rhyza-lite-service/test/selection.test.ts`

**Interfaces:**

- Produces: `SERVICE_START_ORDER` with 20 names, ending in `'ilp-connector-service'`.

- [ ] **Step 1: Update the selection tests**

- In `explicit list is returned in start order, trimmed and deduplicated`: input `' ilp-connector-service ,pal-api-service,pal-api-service'`, expected `['pal-api-service', 'ilp-connector-service']`.
- Rename the count test to `start order has all 20 services, no duplicates`, and assert `20` for both `length` and `Set.size`.
- Add:

```ts
test('ase-mock-service is not part of lite', () => {
  assert.throws(() => selectServices('ase-mock-service'), {
    message: 'unknown service in RHYZA_SERVICES: "ase-mock-service"'
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter rhyza-lite-service test`
Expected: FAIL on the count test (21 != 20) and on the new ase-mock test.

- [ ] **Step 3: Remove the mock from `service-names.ts`, `registry.ts`, `package.json` and the README, then run `pnpm install` to update the lockfile**

- [ ] **Step 4: Run the tests and the build**

Run: `pnpm --filter rhyza-lite-service test && pnpm --filter 'rhyza-lite-service...' build`
Expected: all tests pass and the build exits 0. `grep -rn ase-mock packages/rhyza-lite-service/src packages/rhyza-lite-service/package.json` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/rhyza-lite-service pnpm-lock.yaml
git commit -m "feat(lite): drop ase-mock-service from the lite runner"
```

### Task 2: Mock containers under the `with-ase-mock` profile

**Files:**

- Modify: `docker/docker-compose.lite.yaml`
- Modify: `docker/docker-compose.lite.node-b.yaml`
- Modify: `package.json` (root `lite:*` scripts)

**Interfaces:**

- Consumes: the 20-service runner from Task 1.
- Produces: compose services `ase-mock-service` (node A) and `ase-mock-service-b` (node B), image `rhyza-lite-ase-mock`, profile `with-ase-mock`.

- [ ] **Step 1: Edit the compose files and scripts**

`docker-compose.lite.yaml`:

- `rhyza-lite`: remove the `ase-mock-service` alias and the `'3000:3000'` port. Set `WEBHOOK_URL` as in Global Constraints. Update the "Empty means all 21 services" comment to 20.
- New service `ase-mock-service`, defined inline, not with `extends`: `image: rhyza-lite-ase-mock`, `build` (context `../`, dockerfile `./packages/ase-mock-service/Dockerfile`), `profiles: [with-ase-mock]`, `restart: always`, `mem_limit: 128m`, environment `PORT: 3000` and `ADMIN_URL: http://admin-api-service:3001` (no `HOST`), ports `'3000:3000'`, `depends_on: [rhyza-lite]`, network `rhyza`. Add a comment saying an ASE leaves the profile off and sets `WEBHOOK_URL`.

`docker-compose.lite.node-b.yaml`:

- `rhyza-lite-b`: remove `ase-mock-service` from `RHYZA_SERVICES`, the `ase-mock-service-b` alias and the `'4300:3000'` port. Set `WEBHOOK_URL` from `WEBHOOK_URL_B` as in Global Constraints, with a comment saying why it's a separate variable (e2e exports `WEBHOOK_URL` for node A).
- New service `ase-mock-service-b`: `image: rhyza-lite-ase-mock`, `pull_policy: never`, `profiles: [with-ase-mock]`, `restart: always`, `mem_limit: 128m`, `PORT: 3000`, `ADMIN_URL: http://admin-api-service-b:3001`, ports `'4300:3000'`, `depends_on: [rhyza-lite-b]`, network `rhyza`.

Root `package.json`: add `--profile with-ase-mock` after `-f ./docker/docker-compose.lite.yaml` in `lite:build`, `lite:up` (both compose calls), `lite:stop` and `lite:down`.

- [ ] **Step 2: Check the resolved config (Review Focus 1 to 3)**

Run each command and check the result:

- `docker compose -f docker/docker-compose.lite.yaml config --services`: no `ase-mock-service`.
- `docker compose -f docker/docker-compose.lite.yaml --profile with-ase-mock config --services`: includes `ase-mock-service`.
- `docker compose -f docker/docker-compose.lite.yaml config | grep -E "published: \"?3000"`: no output.
- `WEBHOOK_URL=http://ase.example/hook docker compose -f docker/docker-compose.lite.yaml config | grep WEBHOOK_URL`: `http://ase.example/hook`.
- `WEBHOOK_URL=http://ase-mock-service:3000/webhooks docker compose -f docker/docker-compose.lite.e2e.yaml --profile with-ase-mock config | grep WEBHOOK_URL`: both `http://ase-mock-service:3000/webhooks` and `http://ase-mock-service-b:3000/webhooks`.

- [ ] **Step 3: Start the dev stack**

Run: `pnpm lite:up`, then wait for `Rhyza lite start complete` in `docker logs rhyza-lite-rhyza-lite-1`.
Expected: `docker ps` shows `rhyza-lite-ase-mock-service-1` running. `curl -s -o /dev/null -w '%{http_code}' localhost:3000/webhooks` returns an HTTP status, not a connection refused.

- [ ] **Step 4: Measure memory (Review Focus 4 is checked in Task 3)**

Run: `pnpm lite:mem` after about 4 minutes idle.
Expected: exit 0, five containers listed including the mock. Write the numbers down for Task 3. If the mock is near 128m, raise its `mem_limit` in both compose files.

- [ ] **Step 5: Check teardown (Review Focus 5)**

Run: `pnpm lite:down && docker ps -a --filter label=com.docker.compose.project=rhyza-lite -q`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add docker/docker-compose.lite.yaml docker/docker-compose.lite.node-b.yaml package.json
git commit -m "feat(lite): run ase-mock-service as its own container behind with-ase-mock"
```

### Task 3: Lite e2e, docs and spec amendment

**Files:**

- Modify: `docker/docker-compose.lite.e2e.yaml` (header comment with the usage commands)
- Modify: `docs/src/content/docs/testlocal.mdx` (Lite mode section)
- Modify: `dev-docs/specs/2026-11-24-lite-mode-design.md`

- [ ] **Step 1: Build both nodes with the profile (Review Focus 4)**

Run: `docker compose -f docker/docker-compose.lite.e2e.yaml --profile with-ase-mock build && docker image inspect rhyza-lite-ase-mock --format ok`
Expected: `ok`.

- [ ] **Step 2: Run the e2e suite on two lite nodes**

Run:

```sh
COMPOSE_PROFILES=with-ase-mock E2E_COMPOSE_FILE=docker-compose.lite.e2e.yaml \
  E2E_WAIT_CONTAINER_A=rhyza-lite-1 E2E_WAIT_CONTAINER_B=rhyza-lite-b-1 \
  E2E_WAIT_LOG='Rhyza lite start complete' pnpm e2e
```

Expected: all tests pass. If payments never get approved and the mock containers didn't start, `COMPOSE_PROFILES` isn't reaching compose. Stop and raise it; the spec's fallback (`E2E_COMPOSE_PROFILES` in `tests-e2e`) changes an existing package and needs sign-off.

- [ ] **Step 3: Update the docs**

`docker-compose.lite.e2e.yaml` header: build with `--profile with-ase-mock`, and add `COMPOSE_PROFILES=with-ase-mock` to the e2e command.

`testlocal.mdx` Lite mode section:

- 21 becomes 20 services. The mock runs as a separate `ase-mock-service` container under the `with-ase-mock` profile, and the `lite:*` scripts turn it on.
- `RHYZA_SERVICES` defaults to all 20; drop "including `ase-mock-service`".
- The e2e build and run commands from Steps 1 and 2.
- A new subsection, "Running lite as an ASE": run `docker compose -f docker/docker-compose.lite.yaml up --build -d` without the profile, set `WEBHOOK_URL` to your endpoint, and approve payments through the admin API on port 3001. If `WEBHOOK_URL` isn't set it points at the mock, which isn't running, so webhooks fail and retry and payments stay unapproved.
- The memory table: add an `ase-mock-service` row and update the total with the Task 2 Step 4 numbers. Add `ase-mock-service` 128m to the list of ceilings.

`2026-11-24-lite-mode-design.md`: in section 1 item 1 and item 3, replace the in-process mock text with a pointer to `2026-11-24-lite-ase-mock-container-design.md`. Leave the baseline and constraints sections alone, since they describe the code as it was.

- [ ] **Step 4: Check formatting**

Run: `pnpm prettier --check docs/src/content/docs/testlocal.mdx dev-docs docker package.json packages/rhyza-lite-service`
Expected: no warnings. Run with `--write` if it reports any.

- [ ] **Step 5: Commit**

```bash
git add docker/docker-compose.lite.e2e.yaml docs/src/content/docs/testlocal.mdx dev-docs
git commit -m "docs(lite): document the separate ase mock and running lite as an ASE"
```
