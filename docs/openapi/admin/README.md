# Admin API Changelog Generator

You **must** run this script whenever you update `admin-api.yaml`. It generates a Markdown-formatted changelog of your API modifications to include in your Pull Request.

## Prerequisites

1. Install [`oasdiff`](https://github.com/Tufin/oasdiff#installation).
2. Ensure your main branch is up-to-date.

## Usage

Execute the script from the repository root:

```bash
pnpm generate-admin-changelog
```

## Output

The script diffs the spec against `origin/main` and outputs the API changelog in Markdown format. Copy this output and paste it directly at the beginning of `CHANGELOG.md`.
