#!/bin/zsh
# Run the complete pre-notarization release verification locally.  Packaging is kept
# separate: it is intentionally slow and requires no credentials, while Apple
# Developer signing/notarization remains an owner-controlled release step.
set -euo pipefail

ROOT_DIR="${0:A:h:h}"
cd "${ROOT_DIR}"

npm run license:check
npm run sbom:check
npm run local-only:check
npm run model-fetch:check
# The two repositories share one engine, and each one's suite only ever tests
# its own copy -- so drift between them fails nothing. This is the check that
# says whether they still agree. It skips loudly when the peer checkout is not
# on this machine rather than failing, since one repository alone is a
# legitimate way to work.
npm run parity:check
npm run test:ui
npm run build

# The engine bundle is built before the engine suite runs, so the Apple Vision
# helper exists and the two integration tests execute rather than skipping.
# This is the same order CI uses; without it a local run is quietly weaker than
# the one that gates a release.
npm run engine:package
# `test:engine` already runs bench/test_run.py -- see the script in package.json.
# `npm run test:bench` is kept for running the harness on its own, but calling it
# here as well ran the benchmark suite twice per verify for nothing. The port
# has always run it once; this is the source project catching up.
PHILON_VISION_INTEGRATION=1 npm run test:engine

cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml

if [[ "${1:-}" == "--package" ]]; then
  npm run tauri:package
  # Named from package.json rather than pinned: a hardcoded version turns the
  # first package run after a version bump into "Expected DMG was not produced",
  # which reads as a build failure and is not one.
  VERSION="$(node -p 'require("./package.json").version')"
  DMG_PATH="${ROOT_DIR}/src-tauri/target/release/bundle/dmg/Philon_${VERSION}_aarch64.dmg"
  [[ -f "${DMG_PATH}" ]] || { echo "Expected DMG was not produced: ${DMG_PATH}" >&2; exit 1; }
  hdiutil verify "${DMG_PATH}"
  shasum -a 256 "${DMG_PATH}"
fi
