#!/usr/bin/env bash
# Task 0 probe: confirm node/npm are usable inside WSL via nvm.
# Result: nvm 0.40.3, node v24.18.1, npm 11.16.0 (not on non-login-shell PATH).
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

echo "nvm version: $(nvm --version 2>&1)"
echo "default alias: $(nvm alias default 2>&1)"
nvm use default >/dev/null 2>&1 || nvm use v24.18.1 >/dev/null 2>&1
echo "node: $(command -v node) -> $(node --version 2>&1)"
echo "npm:  $(command -v npm) -> $(npm --version 2>&1)"
