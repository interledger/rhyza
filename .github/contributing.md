# Contributing to this repository <!-- omit in toc -->

Thank you for contributing to Rhyza! Your contributions are essential to making this project better.

## Before you begin

- Have you read the [code of conduct](code_of_conduct.md)?
- Check out the [existing issues](https://github.com/interledger/rhyza/issues) & see if we [accept contributions](#types-of-contributions) for your type of issue.
- If you use AI tools as part of your contribution, make sure you've read our [AI usage policy](../AI_POLICY.md).

## Table of Contents <!-- omit in toc -->

- [Types of contributions](#types-of-contributions)
  - [Discussions](#discussions)
  - [Issues](#issues)
  - [Pull requests](#pull-requests)
- [Working in the Rhyza repository](#working-in-the-rhyza-repository)
  - [Code quality](#code-quality)
    - [Linting](#linting)
    - [Formatting](#formatting)
    - [Testing](#testing)
    - [Language](#language)
    - [CI](#ci)
  - [Reporting Issues](#reporting-issues)
  - [Submitting Pull Requests](#submitting-pull-requests)
  - [Review Process](#review-process)

## Types of contributions

You can contribute to Rhyza in several ways.

### Discussions

Discussions are where we have conversations about Rhyza.

If you would like to discuss topics about the broader ecosystem, have a new idea, or want to show off your work - join us in [discussions](https://github.com/interledger/rhyza/discussions).

### Issues

We use GitHub issues to track tasks that contributors can help with. We haven't finalized labels yet for contributors to tackle. If you want to help with work related to an issue, please comment on the issue before starting work on it.

If you've found something that needs fixing, search open issues to see if someone else has reported the same thing. If it's something new, open an issue. We'll use the issue to discuss the problem you want to fix.

### Pull requests

Feel free to fork and create a pull request on changes you think you can contribute.

The team will review your pull request as soon as possible.

## Working in the Rhyza repository

This project uses pnpm. A list of steps for setting up a [local development environment](https://github.com/interledger/rhyza#local-development-environment) can be found in the Readme.

> DO NOT use `npm install`. This will cause the project to spontaneously self-destruct.

This repository uses a git submodule for Open Payments specifications. Make sure to clone (or update) it recursively:

```shell
git submodule update --init --recursive
```

### Labels

We use labels to communicate the intention of issues and PRs.

- `good first issue` are great issues for newcomers to take on.
- Bounded-context labels (e.g. `payments-bc`, `pal-bc`, `auth-bc`, `ilp-bc`, `notifications-bc`, `admin-api`) are automatically applied to PRs based on which package(s) they touch — see [`.github/labeler.yml`](labeler.yml).

### Code quality

All the code quality tools used in the project are installed and configured at the root.
This allows for consistency across the monorepo and for new packages to be added with
minimal configuration overhead.

We try not to put config files in workspaces, unless absolutely necessary.

#### Linting

[Eslint](https://eslint.org/) is used for linting.

```shell
./eslint.config.mjs # config
```

Eslint config should not be overridden in any packages.

```shell
pnpm check:lint
```

#### Formatting

[Prettier](https://prettier.io/) is used for formatting.

```shell
./.prettierrc.json # config
./.prettierignore # ignore file
```

Prettier config should not be overridden in any packages.

```shell
pnpm format       # write formatting fixes
pnpm check:format # check formatting only
```

Running `pnpm checks` runs both linting and formatting checks together, and is what CI runs on every PR.

#### Testing

Packages use Node's built-in test runner ([`node --test`](https://nodejs.org/api/test.html)) under the hood, exposed via each package's `test` script. Run tests for a single package with:

```shell
pnpm --filter <package-name> test
```

To run the full test suite across the monorepo:

```shell
pnpm test
```

Some packages also define a `test:integration` script, runnable across the monorepo via `pnpm test:integration`.

#### Language

[Typescript](https://www.typescriptlang.org/) is the chosen language.

```shell
./tsconfig.json # config
```

Typescript config at the root is intended to be a base config that should be extended by
each package to suit the package's requirements.

#### CI

We use GitHub Actions to manage our CI pipeline.

The workflows can be found in `.github/workflows`.

## Reporting Issues

If you encounter any issues or have a feature request, please [create a new issue](https://github.com/interledger/rhyza/issues/new/choose) and provide the following details:

- A clear and descriptive title.
- A detailed description of the issue, including steps to reproduce if applicable.
- Information about your environment (e.g., operating system, browser, version).
- Any relevant screenshots or error messages.

## Submitting Pull Requests

1. [Fork](https://github.com/interledger/rhyza) the repository.
2. Create a new branch from `main`.
3. Make your changes and commit them.
4. Create a pull request (PR) to `main`.
5. Ensure your PR includes a clear title and description following the [Conventional Commits Specification](https://www.conventionalcommits.org/en/v1.0.0/).
6. If your PR addresses an issue, reference the issue in the description using `Closes #123`.
7. Be patient and be prepared to address feedback and make changes if needed.

## Review Process

- Project maintainers will review your PR for code quality, correctness, and adherence to guidelines.
- Please respond to any feedback promptly and make necessary changes.
- Once the PR is approved, it will be merged into the main branch.

Thank you for contributing to Rhyza! We appreciate your time and effort in helping make Rhyza better.

Happy coding!
