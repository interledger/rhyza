#!/bin/bash

FILE_PATH="docs/openapi/admin/admin-api.yaml"
BASE_BRANCH="main"
MODE="changelog"

if ! command -v oasdiff &> /dev/null; then
    echo "Error: 'oasdiff' is not installed or not in your PATH."
    exit 1
fi

if [ ! -f "$FILE_PATH" ]; then
    echo "Error: Local file '$FILE_PATH' does not exist."
    exit 1
fi

MERGE_BASE=$(git merge-base HEAD "$BASE_BRANCH")

if [ -z "$MERGE_BASE" ]; then
    echo "Error: Could not find a common ancestor between HEAD and $BASE_BRANCH."
    exit 1
fi

TEMP_BASE=$(mktemp)
trap 'rm -f "$TEMP_BASE"' EXIT

if ! git show "${MERGE_BASE}:${FILE_PATH}" > "$TEMP_BASE" 2>/dev/null; then
    echo "Error: Could not find '$FILE_PATH' at the merge base ($MERGE_BASE)."
    exit 1
fi

echo "Comparing: $FILE_PATH (Current)"
echo "Against:   $BASE_BRANCH (Merge Base commit: ${MERGE_BASE:0:7})"
echo "Mode:      $MODE"
echo "--------------------------------------------------------"

oasdiff "$MODE" "$TEMP_BASE" "$FILE_PATH" --format markdown