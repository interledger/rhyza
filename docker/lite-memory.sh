#!/usr/bin/env bash
# Prints the memory of every running container in a compose project, then the total.
# Exits 1 if the total is over the lite budget (1024 MiB).
#
# Usage: ./docker/lite-memory.sh <compose-project>
set -euo pipefail

BUDGET_MIB=1024

if [ $# -ne 1 ]; then
  echo "usage: $0 <compose-project>" >&2
  exit 2
fi
project="$1"

# docker stats has no --filter flag, so select the project's containers with docker ps.
ids=$(docker ps -q --filter "label=com.docker.compose.project=${project}")
if [ -z "$ids" ]; then
  echo "no running containers for compose project ${project}" >&2
  exit 2
fi

# shellcheck disable=SC2086 # word splitting on the id list is intended
stats=$(docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}' $ids)

# MemUsage looks like "123.4MiB / 768MiB". Only the part before the slash is usage.
# docker prints binary units (B, KiB, MiB, GiB); decimal ones (kB, MB, GB) are accepted too.
printf '%s\n' "$stats" | awk -F '\t' -v budget="$BUDGET_MIB" '
function to_mib(s,    num, unit) {
  gsub(/[[:space:]]/, "", s)
  num = s
  sub(/[A-Za-z]+$/, "", num)
  unit = substr(s, length(num) + 1)
  if (num == "" || num !~ /^[0-9]+(\.[0-9]+)?$/) {
    printf "cannot parse memory value \"%s\"\n", s > "/dev/stderr"
    bad = 1
    return 0
  }
  if (unit == "B")   return num / 1048576
  if (unit == "KiB") return num / 1024
  if (unit == "MiB") return num + 0
  if (unit == "GiB") return num * 1024
  if (unit == "TiB") return num * 1048576
  if (unit == "kB" || unit == "KB") return num * 1000 / 1048576
  if (unit == "MB")  return num * 1000000 / 1048576
  if (unit == "GB")  return num * 1000000000 / 1048576
  printf "unknown memory unit \"%s\" in \"%s\"\n", unit, s > "/dev/stderr"
  bad = 1
  return 0
}
{
  usage = $2
  sub(/\/.*/, "", usage)
  mib = to_mib(usage)
  total += mib
  printf "%-40s %8.1f MiB\n", $1, mib
}
END {
  printf "TOTAL %.1f MiB\n", total
  if (bad) exit 2
  if (total > budget) {
    printf "over budget: %.1f MiB > %d MiB\n", total, budget > "/dev/stderr"
    exit 1
  }
}
'
