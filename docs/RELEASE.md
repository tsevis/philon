# Philon release checklist

1. Run the private gold corpus and archive the benchmark result and hardware details.
2. Run `npm run release:verify`. It is one command and it runs the whole gate, in
   this order: the licence, SBOM, local-only, **model-fetch** and **engine-parity**
   policies — five of them, not three — then the interface suite, `tsc` and the
   production bundle, the engine bundle, the engine suite with the Apple Vision
   integration tests enabled — which carries the benchmark harness with it, so
   `test:bench` is not run separately — and `cargo test` and `cargo check`. Running the individual scripts by hand is how a step gets
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
6. Sign, notarize and staple, in the protected release environment. Sign
   inside-out -- a bundle signature seals the resources beneath it, so anything
   re-signed afterwards invalidates the seal above it:

       ID="Developer ID Application: <name> (<team>)"
       codesign --force --timestamp --options runtime --sign "$ID" \
         Philon.app/Contents/Resources/_up_/engine/dist/philon-vision-ocr
       codesign --force --timestamp --options runtime \
         --entitlements src-tauri/engine.entitlements --sign "$ID" \
         Philon.app/Contents/Resources/_up_/engine/dist/philon-engine
       codesign --force --timestamp --options runtime --sign "$ID" Philon.app

   Then confirm the entitlements actually took, because `codesign` will not tell
   you. AMFI rejects XML comments in an entitlements plist, prints a parse error
   and exits 0 -- signing the binary with no entitlements at all:

       codesign -d --entitlements - --xml \
         Philon.app/Contents/Resources/_up_/engine/dist/philon-engine | plutil -p -

   The app and the DMG are notarized separately, and both need a ticket. A
   ticket stapled only to the image covers the download; the moment someone
   drags the app to /Applications it carries nothing of its own, and a first
   launch without a network can stall at Gatekeeper. So notarize the app first,
   staple it, and only then build the image around the stapled copy:

       ditto -c -k --keepParent Philon.app Philon.zip
       xcrun notarytool submit Philon.zip --keychain-profile <profile> --wait
       xcrun stapler staple Philon.app

   Then build the DMG around that stapled bundle, sign the image, and notarize
   and staple it in turn. Converting the packaged DMG to UDRW, replacing
   `Philon.app` with `ditto`, and converting back to UDZO preserves the window
   layout, `.DS_Store` and `.VolumeIcon.icns` that `bundle_dmg.sh` set up.

       codesign --force --timestamp --sign "$ID" <dmg>
       xcrun notarytool submit <dmg> --keychain-profile <profile> --wait
       xcrun stapler staple <dmg>

   Check both layers, not just the one you stapled last. `spctl` on the image
   says nothing about the bundle inside it:

       xcrun stapler validate <dmg>
       spctl -a -vvv -t open --context context:primary-signature <dmg>
       hdiutil attach <dmg> -nobrowse -readonly -mountpoint /tmp/v
       spctl -a -vvv /tmp/v/Philon.app && xcrun stapler validate /tmp/v/Philon.app

   Store the credentials once with `xcrun notarytool store-credentials`; it
   validates against Apple before storing, so a bad key or issuer fails there
   with a usable message rather than as a bare 401 at submit time. The key must
   be a Team key with Developer access -- an Individual key authenticates for
   other App Store Connect APIs and is refused by `notarytool`.
7. Install the notarized DMG on a clean Apple-Silicon macOS 15 machine and repeat
   offline conversion, review, queue recovery, and malformed-input tests. Install
   with `ditto`, never `cp -R`: `cp -R` does not preserve the bundle seal and
   `codesign --verify --deep --strict` then fails on a bundle that was fine in the
   DMG.
8. Tag the commit the build came from and publish the stapled DMG as the
   release asset, with the SHA-256 recorded in step 5 beside it. Binaries are not
   committed to the tree -- see `releases/README.md`. Tag only after step 7
   passes: notarization says Apple checked the signature, not that the engine
   starts.

9. Publish benchmark methodology and only make comparative claims the archived
   corpus supports. A recorded benchmark result names the documents it measured by
   filename, size and SHA-256, so "the same version-pinned corpus" is something a
   reader can check rather than something the runner asserts.
