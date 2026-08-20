#!/usr/bin/env bash
# Task 0 probe: SBF build inside WSL, sourcing crates from the Windows cargo
# registry and building --offline to sidestep the broken-IPv6 download failure.
# Result: SUCCESS - produced target/deploy/sbf_probe.so (11,408 bytes), exit 0.
set -uo pipefail

export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

SRC=/mnt/c/Users/dre30/Projects/test2/sbf_probe
DST="$HOME/_sbf_probe"

rm -rf "$DST"
mkdir -p "$DST/src"
cp "$SRC/Cargo.toml" "$DST/Cargo.toml"
cp "$SRC/src/lib.rs" "$DST/src/lib.rs"
[ -f "$SRC/Cargo.lock" ] && cp "$SRC/Cargo.lock" "$DST/Cargo.lock" && echo "Cargo.lock copied"
cd "$DST" || exit 1

echo "=== attempt: offline build using Windows cargo registry ==="
export CARGO_HOME=/mnt/c/Users/dre30/.cargo
export CARGO_NET_OFFLINE=true
cargo-build-sbf 2>&1 | tail -25
echo "BUILD_EXIT=${PIPESTATUS[0]}"

echo "=== artifact ==="
ls -la "$DST"/target/deploy/ 2>&1 || echo "no target/deploy"
