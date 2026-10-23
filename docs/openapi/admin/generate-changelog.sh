#!/bin/bash

FILE_PATH="docs/openapi/admin/admin-api.yaml"
CHANGELOG_PATH="docs/openapi/admin/CHANGELOG.md"
BASE_BRANCH="main"
MODE="changelog"

if command -v oasdiff &> /dev/null; then
    echo "Using local oasdiff: $(command -v oasdiff)"
    OASDIFF_CMD=(oasdiff)
elif command -v docker &> /dev/null; then
    echo "Local oasdiff not found. Using Docker: tufin/oasdiff"
    OASDIFF_CMD=(
        docker run --rm
        -v "$(pwd):/work"
        -w /work
        tufin/oasdiff
    )
else
    echo "Error: 'oasdiff' is not installed and Docker is not available."
    exit 1
fi

if [ ! -f "$FILE_PATH" ]; then
    echo "Error: Local file '$FILE_PATH' does not exist."
    exit 1
fi

if [ ! -f "$CHANGELOG_PATH" ]; then
    echo "Error: Local file '$CHANGELOG_PATH' does not exist."
    exit 1
fi

BASE_REF="origin/${BASE_BRANCH}"

# Created inside the repo so it is visible to the Docker fallback's bind mount.
TEMP_BASE="$(mktemp "./.oasdiff-base.XXXXXX")"
TEMP_CHANGELOG="$(mktemp)"
trap 'rm -f "$TEMP_BASE" "$TEMP_CHANGELOG"' EXIT

if ! git show "${BASE_REF}:${FILE_PATH}" > "$TEMP_BASE" 2>/dev/null; then
    echo "Error: Could not find '$FILE_PATH' at $BASE_REF."
    echo "Try: git fetch origin $BASE_BRANCH"
    exit 1
fi

echo "Comparing: $FILE_PATH (Current)"
echo "Against:   $BASE_REF"
echo "Mode:      $MODE"
echo "--------------------------------------------------------"

if ! CHANGES="$("${OASDIFF_CMD[@]}" "$MODE" "$TEMP_BASE" "$FILE_PATH" --format markdown)"; then
    echo "Error: oasdiff failed."
    exit 1
fi

# oasdiff starts its output with "# API Changelog <base> vs. <revision>".
HEADER="$(printf '%s\n' "$CHANGES" | head -n 1)"
if [[ "$HEADER" != "# API Changelog "*" vs. "* ]]; then
    echo "Error: Unexpected oasdiff output:"
    printf '%s\n' "$CHANGES"
    exit 1
fi

BODY="$(printf '%s\n' "$CHANGES" | tail -n +2 | tr -d '[:space:]')"
if [ -z "$BODY" ] || [ "$BODY" = "Nochangesdetected" ]; then
    echo "No changes detected. '$CHANGELOG_PATH' was not modified."
    exit 0
fi

# A section written by an earlier run on this branch has the same base, even
# if the revision has changed since (e.g. after a version bump). Replace it
# instead of adding a second one.
BASE_PREFIX="${HEADER%% vs. *} vs. "

{
    # oasdiff leaves runs of blank lines between sections; squeeze them.
    printf '%s\n\n' "$CHANGES" | cat -s
    awk -v prefix="$BASE_PREFIX" '
        index($0, prefix) == 1 { skip = 1; next }
        /^# API Changelog / { skip = 0 }
        !skip { print }
    ' "$CHANGELOG_PATH" | sed '/./,$!d'
} > "$TEMP_CHANGELOG"

cat "$TEMP_CHANGELOG" > "$CHANGELOG_PATH"

echo "Updated '$CHANGELOG_PATH' with:"
echo
printf '%s\n' "$CHANGES" | cat -s
