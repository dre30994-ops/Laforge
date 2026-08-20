#!/usr/bin/env bash
# Build the SBF program inside WSL, sourcing crates from the Windows cargo
# registry and staying offline (WSL IPv6 is broken, so downloads fail).
#
# Usage: wsl -d Ubuntu -- bash /mnt/c/Users/dre30/Projects/test2/build_sbf.sh
set -uo pipefail

export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
export CARGO_HOME=/mnt/c/Users/dre30/.cargo
export CARGO_NET_OFFLINE=true

PROJ=/mnt/c/Users/dre30/Projects/test2
cd "$PROJ/programs/staking" || exit 1

echo "=== toolchain ==="
cargo-build-sbf --version 2>&1
echo "active: $(rustup show active-toolchain 2>&1)"

echo
echo "=== cargo-build-sbf ==="
cargo-build-sbf --sbf-out-dir "$PROJ/target/deploy" 2>&1
echo "BUILD_EXIT=$?"

echo
echo "=== artifact ==="
ls -la "$PROJ/target/deploy/" 2>&1 | grep -E '\.so$|total' || echo "no .so produced"
