# Releases

Built DMGs, kept beside the source they were built from.

A build here is produced by `npm run release:verify -- --package`, which runs
the whole gate before it packages anything: the licence, SBOM, local-only,
model-fetch and engine-parity policies, the interface suite, `tsc` and the
production bundle, the engine bundle, the engine suite with the Apple Vision
integration tests and the benchmark harness it carries, and the Rust tests. A DMG that exists
here passed all of it.

The parity policy is the one with a caveat worth knowing: it passes, loudly on
stderr, when the port's checkout is not on the machine. A build made without
`philon_p` beside this repository is a build whose engine was never compared
against the other copy of itself.

## Verifying a download

    shasum -a 256 -c Philon_0.2.6_aarch64.dmg.sha256

The checksum is recorded at build time from the same file `hdiutil verify`
accepted.

## Signing

These are signed ad-hoc (`codesign --sign -`) and **not** notarized: Apple
Developer signing and notarization need credentials that are deliberately kept
out of the build, so packaging stays reproducible by anyone with the source and
requires nothing secret.

macOS will therefore refuse the first launch of a downloaded copy. Open it from
the shortcut menu — Control-click the app, choose Open, then confirm — which
asks Gatekeeper for this one application rather than turning the check off. A
copy built on your own machine carries no quarantine attribute and opens
normally.

## Which architecture

`aarch64` is Apple silicon. There is no Intel build: the engine bundles a
PyInstaller binary and a Swift Vision helper compiled for the host, so a
universal DMG would have to be built on, or cross-built for, both.
