# Releases

Built DMGs are no longer committed here. A binary is published as an asset on a
tagged GitHub release, so this repository carries source and each build hangs off
the tag it was built from rather than sitting in the tree.

This directory keeps only this note. Anything else in it is a local working copy
and is ignored by git.

A published build is produced by `npm run release:verify -- --package`, which runs
the whole gate before it packages anything: the licence, SBOM, local-only,
model-fetch and engine-parity policies, the interface suite, `tsc` and the
production bundle, the engine bundle, the engine suite with the Apple Vision
integration tests and the benchmark harness it carries, and the Rust tests. A DMG
that reaches a release passed all of it.

The parity policy is the one with a caveat worth knowing: it passes, loudly on
stderr, when the port's checkout is not on the machine. A build made without
`philon_p` beside this repository is a build whose engine was never compared
against the other copy of itself. Set `PHILON_PARITY_REQUIRE=1` for a release
build and the skip becomes a failure, so the comparison cannot be missed by not
reading stderr.

## Verifying a download

Each release asset is published with its SHA-256, recorded at build time from the
same file `hdiutil verify` accepted:

    shasum -a 256 -c Philon_<version>_aarch64.dmg.sha256

## Signing

A published asset is signed with the project Apple Developer ID and notarized by
Apple, and the notarization ticket is stapled to the DMG so first launch works
without a network round trip. Every executable in the bundle carries the hardened
runtime and a secure timestamp.

One of them carries an entitlement, and the reason is worth recording.
`philon-engine` is a PyInstaller `--onefile` bundle: at startup its bootloader
unpacks libpython and the collected extension modules into a temporary directory
and loads them from there. Those copies are not individually signed, so hardened
runtime library validation refuses them and the engine dies before serving a
request. `src-tauri/engine.entitlements` therefore grants that one binary
`com.apple.security.cs.disable-library-validation` and
`com.apple.security.cs.allow-dyld-environment-variables`.

Apple's notary service cannot see inside the PyInstaller archive, so a build that
is missing this entitlement notarizes cleanly and then fails on every machine
that is not the one it was built on. Notarization is not evidence that the engine
starts; step 7 of `docs/RELEASE.md` — install on a clean machine with `ditto` and
convert a document offline — is the only thing that is.

Keep the entitlements file free of XML comments. AMFI's plist parser rejects
them, and `codesign` reports the parse error and then exits 0, producing a binary
with no entitlements at all that passes every later check.

## Which architecture

`aarch64` is Apple silicon. There is no Intel build: the engine bundles a
PyInstaller binary and a Swift Vision helper compiled for the host, so a
universal DMG would have to be built on, or cross-built for, both.
