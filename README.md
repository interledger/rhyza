# Rafiki v2

This repository contains Rafiki’s new architecture: a suite of performant, horizontally scalable services that enable financial service providers (FSPs) to provide Interledger and Open Payments functionality to their users.

## Project Architecture

The project follows a modular architecture based on **Domain-Driven Design (DDD)**, where each **Bounded Context (BC)** is split into several packages to ensure a separation of concerns.

- [Project Structure & Guidelines](./internal-docs/Structure%20&%20Guidelines.md)
- [Project Structure Diagram](./internal-docs/diagrams/structure.png)
- [Architecture Diagram](./internal-docs/diagrams/architecture.png)
- [Sequence Diagrams](./internal-docs/sequence-diagrams/)

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (use [nvm](https://github.com/nvm-sh/nvm) for version management)
- [pnpm](https://pnpm.io/)
- [Docker](https://www.docker.com/)

### Installation & Build

1. **Set up Node version**:

   ```shell
   nvm install
   nvm use
   ```

2. **Initialize git submodule**:
   This repository uses a git submodule for Open Payments specifications located at `open-payments-specifications/`.

   ```shell
   git submodule update --init --recursive
   ```

3. **Enable corepack and install dependencies**:

   ```shell
   corepack enable
   pnpm install
   ```

4. **Build the project**:
   ```shell
   pnpm -r build
   ```

### Running Tests

To run the full test suite:

```shell
pnpm test
```

## Running with Docker Compose

The easiest way to run the entire stack is using Docker Compose.

```shell
pnpm docker compose up -d --build
```

### Monitoring & Dashboards

Once the services are running, you can monitor them at:

- **Grafana**: [http://localhost:4501](http://localhost:4501)
- **Redpanda (Kafka Console)**: [http://localhost:8080](http://localhost:8080)

### Benchmarking

To run a performance benchmark using [k6](https://k6.io/):

```shell
k6 run benchmark.js
```

### Cleanup

To stop and remove all containers, volumes, and images:

```shell
pnpm docker down --volumes --rmi all
```

## Releasing

Versioning lives in git branch names and tags, computed in CI.

Branch off `main` as `release/vX.Y[.Z][-suffix]` (for example `release/v2.4`, `release/v2.4-beta`, or `release/v2.4.1-beta`) and push it. The `Release` workflow parses `major.minor[-suffix]` from the branch name, finds the highest existing tag with that prefix, bumps the patch by 1, and force-pushes the new tag. If the branch includes an explicit patch and no matching tag exists, that patch is used as the first version. Pushing again to the same release branch computes the next patch.

It then builds `linux/amd64` and `linux/arm64` images for each deployable service (not `ase-mock-service` or `http-signature-service`), publishes them to GHCR, and creates or updates a GitHub Release.

Images are named `ghcr.io/interledger/rhyza-<package>-<arch>:<version>`. A version such as `v2.4.2` is also tagged as `v2.4` and `v2`, and a multi-arch manifest is published at `ghcr.io/interledger/rhyza-<package>:<version>`. Those aliases are only moved on `release/v*` publishes, not on `workflow_dispatch`.

`workflow_dispatch` on a non-`main` ref builds and pushes images tagged with a sanitized form of the ref name (`/` becomes `_`), with no git tag, GitHub Release, or parent aliases. A push to `main` runs the workflow without publishing. Other branches do not trigger it.

Changelog categories come from PR labels via `.github/release.yml`: `breaking` (Breaking Changes), `dependencies` (Dependency Updates), and every remaining PR (General Changes). Create the `breaking` and `dependencies` labels in the GitHub repo before using them on PRs. Versions ending in `-alpha` are marked prerelease. GitHub picks the highest published semver as the repo's Latest release, so a patch on an older major (for example `v1.0.1` after `v2.0.0`) does not take over Latest. GitHub generates the release notes, including on the first tag when no previous release exists.
