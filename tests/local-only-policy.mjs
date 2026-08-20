import { readFile } from "node:fs/promises";

// Default conversion is a local Unix-socket workflow. Keep an explicit
// source-level gate close to the dependency/SBOM gates so an accidental HTTP
// client cannot become part of the production path unnoticed.
const sources = [
  new URL("../engine/philon_engine.py", import.meta.url),
  new URL("../src-tauri/src/main.rs", import.meta.url),
  new URL("../engine/requirements.txt", import.meta.url),
  new URL("../src-tauri/Cargo.toml", import.meta.url),
];
const forbidden = [
  /(?:^|\n)\s*(?:from\s+requests|import\s+requests|from\s+urllib\.request)/i,
  /(?:^|\n)\s*(?:requests|reqwest|hyper|curl)(?:[<=>@\s]|$)/im,
  /\bCommand::new\(\s*"(?:curl|wget)"/i,
];

for (const source of sources) {
  const text = await readFile(source, "utf8");
  const match = forbidden.find((pattern) => pattern.test(text));
  if (match) throw new Error(`Local-only policy rejected ${source.pathname}: ${match}`);
}

console.log(`Local-only policy passed for ${sources.length} runtime sources.`);
