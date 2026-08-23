# Philon release checklist

1. Run the private gold corpus and archive the benchmark result and hardware details.
2. Run `npm run release:verify`. It is one command and it runs the whole gate, in
   this order: the licence, SBOM, local-only, **model-fetch** and **engine-parity**
   policies — five of them, not three — then the interface suite, `tsc` and the
   production bundle, the engine bundle, the engine suite with the Apple Vision
   integration tests enabled, the benchmark suite, and `cargo test` and
   `cargo check`. Running the individual scripts by hand is how a step gets
   skipped; this checklist used to name a subset of them, and so described a
   weaker gate than the one that actually runs.
3. Confirm the parity gate compared something rather than skipping. It passes —
   loudly, on stderr — when the port's checkout is absent, because one repository
   alone is a legitimate way to work. A release build must therefore be made with
   `philon_p` beside this repository, or with `PHILON_PARITY_PEER` pointing at it.
   Read the line it prints: it names how many files were byte-identical.
   `PHILON_PARITY_REQUIRE=1` turns the skip into a failure if you would rather not
   have to read it.
4. Verify the frozen engine's authenticated health endpoint locally. Step 2 has
   already built it — `engine:package` runs inside `release:verify`, before the
   engine suite, so that the Apple Vision integration tests execute rather than
   skip. The health check is the part no gate covers, which is the only reason
   this is a step of its own.
5. Build the ad-hoc signed application with `npm run tauri:package` on an
   Apple-Silicon macOS 15 runner. `npm run release:verify -- --package` does steps
   2 and 5 together and additionally runs `hdiutil verify` on the DMG and records
   its SHA-256.
6. Sign the application and engine with the project Apple Developer identity, then
   notarize and staple the DMG in the protected release environment.
7. Install the notarized DMG on a clean Apple-Silicon macOS 15 machine and repeat
   offline conversion, review, queue recovery, and malformed-input tests. Install
   with `ditto`, never `cp -R`: `cp -R` does not preserve the bundle seal and
   `codesign --verify --deep --strict` then fails on a bundle that was fine in the
   DMG.
8. Publish benchmark methodology and only make comparative claims the archived
   corpus supports. A recorded benchmark result names the documents it measured by
   filename, size and SHA-256, so "the same version-pinned corpus" is something a
   reader can check rather than something the runner asserts.
