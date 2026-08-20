#!/usr/bin/env bash
# Task 0 probe: attempt an SBF build inside WSL on the Linux filesystem.
# Result: failed only on dependency download (WSL IPv6 broken), not on the toolchain.
set -uo pipefail

export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

echo "=== versions ==="
rustc --version
solana --version
anchor --version
cargo-build-sbf --version

echo "=== copy probe to Linux filesystem ==="
rm -rf "$HOME/_sbf_probe"
mkdir -p "$HOME/_sbf_probe/src"
cp /mnt/c/Users/dre30/Projects/test2/sbf_probe/Cargo.toml "$HOME/_sbf_probe/Cargo.toml"
cp /mnt/c/Users/dre30/Projects/test2/sbf_probe/src/lib.rs "$HOME/_sbf_probe/src/lib.rs"
cd "$HOME/_sbf_probe" || exit 1
pwd

echo "=== cargo-build-sbf ==="
cargo-build-sbf 2>&1 | tail -30
echo "BUILD_EXIT=${PIPESTATUS[0]}"

echo "=== artifact ==="
ls -la target/deploy/ 2>&1 || echo "no target/deploy"
