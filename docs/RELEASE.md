# Philon release checklist

1. Run the private gold corpus and archive the benchmark result and hardware details.
2. Run `npm run license:check`, `npm run sbom:check`, `npm run build`, Python tests, and `cargo check`.
3. Build the frozen engine with `npm run engine:package` and verify its authenticated health endpoint locally.
4. Build the unsigned application with `npm run tauri:package` on an Apple-Silicon macOS 15 runner.
5. Sign the application and engine with the project Apple Developer identity, then notarize and staple the DMG in the protected release environment.
6. Install the notarized DMG on a clean Apple-Silicon macOS 15 machine and repeat offline conversion, review, queue recovery, and malformed-input tests.
7. Publish benchmark methodology and only make comparative claims the archived corpus supports.
