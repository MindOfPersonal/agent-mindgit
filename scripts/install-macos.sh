#!/bin/bash
# MindGit Agent v2 - macOS Installer
# Delegeert naar install-linux.sh, dat zowel Linux (systemd) als macOS (launchd) afhandelt.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/install-linux.sh" "$@"
