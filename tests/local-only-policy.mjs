import { readFile, readdir } from "node:fs/promises";

// Default conversion is a local Unix-socket workflow. Keep an explicit
// source-level gate close to the dependency/SBOM gates so an accidental HTTP
// client cannot become part of the production path unnoticed.
//
// The gate proves itself before it scans: a pattern set that has quietly
// stopped matching would otherwise report a pass forever. The front end is
// scanned too -- it can reach the network with a bare fetch(), and nothing
// here used to look at it.
const roots = [
  new URL("../engine/philon_engine.py", import.meta.url),
  new URL("../engine/requirements.txt", import.meta.url),
  new URL("../src-tauri/src/main.rs", import.meta.url),
  new URL("../src-tauri/Cargo.toml", import.meta.url),
  new URL("../bench/run.py", import.meta.url),
];

const forbidden = [
  /(?:^|\n)\s*(?:from|import)\s+(?:requests|httpx|aiohttp|urllib3|boto3|openai|anthropic)\b/i,
  /(?:^|\n)\s*(?:from|import)\s+urllib\b/i,
  /(?:^|\n)\s*(?:requests|httpx|aiohttp|urllib3|reqwest|hyper|curl|boto3|openai|torch)(?:[<=>@~!\s]|$)/im,
  /\bCommand::new\(\s*"(?:curl|wget)"/i,
  /(?:curl|wget)\s+(?:-\S+\s+)*https?:\/\//i,
  /\bsocket\.(?:create_connection|socket)\s*\(/i,
  /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/,
  /\bnavigator\.sendBeacon\b/,
];

// Samples the gate MUST reject. If any slips through, the patterns are broken
// and every "passed" this script has ever printed was meaningless.
const mustReject = [
  "import os\nimport requests\n",
  "import httpx\n",
  "from urllib.request import urlopen\n",
  "pypdfium2==4.30.0\nrequests==2.32.0\n",
  '[dependencies]\nreqwest = "0.12"\n',
  'Command::new("curl")',
  "s = socket.create_connection((host, 443))\n",
  'await fetch("https://example.invalid")\n',
  'new WebSocket("wss://example.invalid")\n',
  "navigator.sendBeacon('/t', d)\n",
];
// Samples it MUST accept, drawn from shapes the real sources contain.
const mustAccept = [
  "import asyncio\nserver = await asyncio.start_unix_server(handle, path=str(p))\n",
  "import subprocess\nsubprocess.run([str(helper), str(path)], check=True)\n",
  "pypdfium2==4.30.0\npypdf==5.1.0\nPillow==11.0.0\n",
  "const value = await invoke(\"convert_document\", { config });\n",
];

const offending = (text) => forbidden.filter((pattern) => pattern.test(text));

for (const sample of mustReject) {
  if (!offending(sample).length) {
    throw new Error(`Local-only policy is broken: it accepts ${JSON.stringify(sample)}`);
  }
}
for (const sample of mustAccept) {
  const hits = offending(sample);
  if (hits.length) {
    throw new Error(`Local-only policy is too broad: ${JSON.stringify(sample)} rejected by ${hits}`);
  }
}

/** Every front-end source, which can reach the network with one bare call. */
async function frontEndSources(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) found.push(...(await frontEndSources(child)));
    else if (/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name)) found.push(child);
  }
  return found;
}

const sources = [...roots, ...(await frontEndSources(new URL("../src/", import.meta.url)))];
for (const source of sources) {
  const hits = offending(await readFile(source, "utf8"));
  if (hits.length) throw new Error(`Local-only policy rejected ${source.pathname}: ${hits}`);
}

console.log(
  `Local-only policy passed for ${sources.length} runtime sources ` +
  `(${mustReject.length} rejection samples and ${mustAccept.length} acceptance samples verified first).`,
);
