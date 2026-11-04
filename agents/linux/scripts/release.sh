#!/usr/bin/env bash
# Builds reproducible, static Linux amd64/arm64 agent archives plus SHA256SUMS.
# Usage: agents/linux/scripts/release.sh <version> [outdir]
# Signing: sign SHA256SUMS out-of-band (e.g. `cosign sign-blob` or `gpg --detach-sign`) in the release pipeline.
set -euo pipefail

version="${1:?usage: release.sh <version> [outdir]}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || { echo "invalid version: $version" >&2; exit 2; }
cd "$(dirname "$0")/.."
out="$(realpath -m "${2:-bin/release}")"
rm -rf -- "$out"
mkdir -p "$out"

for arch in amd64 arm64; do
  name="nodexxa-agent_${version}_linux_${arch}"
  stage="$(mktemp -d)"
  CGO_ENABLED=0 GOOS=linux GOARCH="$arch" go build -trimpath -buildvcs=false \
    -ldflags "-s -w -X main.version=${version}" -o "$stage/nodexxa-agent" ./cmd/nodexxa-agent
  cp ../../deploy/systemd/nodexxa-agent.service ../../deploy/systemd/config.example.json "$stage/"
  tar --sort=name --owner=0 --group=0 --numeric-owner --mtime='2020-01-01 00:00Z' -C "$stage" -czf "$out/$name.tar.gz" .
  rm -rf -- "$stage"
done
(cd "$out" && sha256sum ./*.tar.gz | sed 's# \./# #' > SHA256SUMS)
cat "$out/SHA256SUMS"
