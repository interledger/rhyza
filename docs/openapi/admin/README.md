# Admin API Changelog Generator

You **must** run this script whenever you update `admin-api.yaml`. It generates a Markdown-formatted changelog of your API modifications and adds it to `CHANGELOG.md`, which you commit with your Pull Request.

## Prerequisites

1. Install [`oasdiff`](https://github.com/Tufin/oasdiff#installation).
2. Ensure your main branch is up-to-date.

## Usage

Execute the script from the repository root:

```bash
pnpm generate-admin-changelog
```

## Output

The script compares `admin-api.yaml` against `origin/main` and writes the API diff in Markdown format to the beginning of `CHANGELOG.md`. Commit the updated `CHANGELOG.md` with your changes.

Running it again on the same branch, for example after more spec edits or a version bump, replaces the section it wrote before instead of adding a second one. If there are no changes to the spec, `CHANGELOG.md` is left untouched.
