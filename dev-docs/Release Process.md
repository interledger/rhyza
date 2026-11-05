# Release Process

Versioning lives in git branch names and tags, computed in CI.

Branch off `main` as `release/vX.Y[.Z][-suffix]` (for example `release/v2.4`, `release/v2.4-beta`, or `release/v2.4.1-beta`) and push it. The `Release` workflow parses `major.minor[-suffix]` from the branch name, finds the highest existing tag with that prefix, bumps the patch by 1, and force-pushes the new tag. If the branch includes an explicit patch and no matching tag exists, that patch is used as the first version. Pushing again to the same release branch computes the next patch.

It then builds `linux/amd64` and `linux/arm64` images for each deployable service (not `ase-mock-service` or `http-signature-service`), publishes them to GHCR, and creates or updates a GitHub Release.

Images are named `ghcr.io/interledger/rhyza-<package>-<arch>:<version>`. A version such as `v2.4.2` is also tagged as `v2.4` and `v2`, and a multi-arch manifest is published at `ghcr.io/interledger/rhyza-<package>:<version>`. Those aliases are only moved on `release/v*` publishes, not on `workflow_dispatch`.

`workflow_dispatch` on a non-`main` ref builds and pushes images tagged with a sanitized form of the ref name (`/` becomes `_`), with no git tag, GitHub Release, or parent aliases. A push to `main` runs the workflow without publishing. Other branches do not trigger it.

Changelog categories come from PR labels via `.github/release.yml`: `breaking` (Breaking Changes), `dependencies` (Dependency Updates), and every remaining PR (General Changes). Create the `breaking` and `dependencies` labels in the GitHub repo before using them on PRs. Versions ending in `-alpha` are marked prerelease. GitHub picks the highest published semver as the repo's Latest release, so a patch on an older major (for example `v1.0.1` after `v2.0.0`) does not take over Latest. GitHub generates the release notes, including on the first tag when no previous release exists.

## Linear releases

After the GitHub Release is created, the `generate-release` job runs [`linear/linear-release-action`](https://github.com/linear/linear-release-action) `sync` against the Rhyza release pipeline in Linear. The Linear release's name and version are the computed version (for example `v2.4.1`). Every GitHub Release gets a matching Linear release, including prereleases such as `-alpha` and `-beta`. `workflow_dispatch` builds and pushes to `main` don't create a GitHub Release, so they don't create a Linear release either. The pipeline is continuous, so `sync` creates the release already completed. There is no separate `complete` or `update` step.

`sync` scans the commits between the previous Linear release's commit and the release commit. It links every Linear issue ID matching `RHY-<number>` in a commit subject (set with `issue_pattern`), along with anything Linear's built-in detection finds. Since PRs are squash-merged, the subject is the PR title, so PR titles must end with the issue ID, for example `fix: decode the GNAP access token [RHY-123]`. See [Linear issue references](../.github/contributing.md#linear-issue-references). If no commit in the range references an issue, `sync` creates no Linear release for that version.

The action authenticates with a Linear pipeline access key stored in the `LINEAR_ACCESS_KEY` repository secret. To rotate the key, generate a new one in the Rhyza pipeline's settings in Linear and replace the secret.
