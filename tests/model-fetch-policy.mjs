import { readFile } from "node:fs/promises";

// engine/model_fetch.py is the one file tests/local-only-policy.mjs exempts, so
// the exemption is only as good as what this gate holds that file to. A file
// allowed to open connections and then trusted to be careful is not a policy.
//
// Four properties are checked in the source, and the manifest is checked
// against the same rules, because a download block naming an arbitrary host or
// carrying no digest would walk around all four.

const fetcher = new URL("../engine/model_fetch.py", import.meta.url);
const manifest = new URL("../engine/model-manifest.json", import.meta.url);
const source = await readFile(fetcher, "utf8");
const failures = [];

// 1. Only the standard library. A new HTTP dependency would be a new SBOM
//    entry and a new supply-chain surface for the one file that talks to a host.
for (const banned of ["requests", "httpx", "aiohttp", "urllib3", "boto3", "reqwest"]) {
  if (new RegExp(`(?:^|\\n)\\s*(?:from|import)\\s+${banned}\\b`).test(source)) {
    failures.push(`model_fetch.py imports ${banned}; it must use only the standard library.`);
  }
}

// 2. An explicit host allow-list that is actually consulted, and consulted by
//    exact match. A suffix test would accept huggingface.co.example.invalid.
if (!/MODEL_HOST_ALLOWLIST\s*=\s*\(/.test(source)) {
  failures.push("model_fetch.py declares no MODEL_HOST_ALLOWLIST.");
}
if (!/host in MODEL_HOST_ALLOWLIST/.test(source)) {
  failures.push("model_fetch.py never checks a host against MODEL_HOST_ALLOWLIST by exact match.");
}
if (/endswith\(\s*MODEL_HOST_ALLOWLIST/.test(source)) {
  failures.push("model_fetch.py matches hosts by suffix, which accepts a look-alike domain.");
}

// 3. HTTPS only, and every redirect hop re-checked rather than the first URL.
if (!/scheme\.lower\(\)\s*!=\s*"https"/.test(source)) {
  failures.push("model_fetch.py does not require HTTPS.");
}
if (!/for _ in range\(MAX_REDIRECTS/.test(source) || !/is_allowed_url\(current\)/.test(source)) {
  failures.push("model_fetch.py does not re-check each redirect hop against the allow-list.");
}

// 4. Nothing is installed before its bytes match. The move into place must be
//    the last thing that happens, after the digest comparison.
if (!/hashlib\.sha256\(\)/.test(source)) failures.push("model_fetch.py computes no SHA-256.");
if (!/os\.replace\(temporary, destination\)/.test(source)) {
  failures.push("model_fetch.py does not install atomically from a temporary file.");
}
const digestAt = source.indexOf("did not match its declared SHA-256");
const installAt = source.indexOf("os.replace(temporary, destination)");
if (digestAt < 0 || installAt < 0 || digestAt > installAt) {
  failures.push("model_fetch.py installs the file before comparing its digest.");
}
if (!/if not pack\.get\("approved", False\)/.test(source)) {
  failures.push("model_fetch.py does not refuse an unapproved pack.");
}

// 5. The manifest's own download blocks. Every declared file needs a digest and
//    a size, and the repository must be one the allow-list can serve.
const declared = JSON.parse(await readFile(manifest, "utf8"));
let blocks = 0;
let files = 0;
for (const pack of declared.packs ?? []) {
  const download = pack.download;
  if (!download) continue;
  blocks += 1;
  if (!download.repository || /^https?:/i.test(download.repository) || download.repository.includes("..")) {
    failures.push(`${pack.id} declares an unusable download repository.`);
  }
  for (const file of download.files ?? []) {
    files += 1;
    if (!/^[0-9a-f]{64}$/.test(String(file.sha256 ?? ""))) {
      failures.push(`${pack.id}/${file.name} has no usable SHA-256.`);
    }
    if (!Number.isInteger(file.bytes) || file.bytes <= 0) {
      failures.push(`${pack.id}/${file.name} declares no byte count.`);
    }
    if (/^\/|\.\.|\\\\/.test(String(file.name ?? ""))) {
      failures.push(`${pack.id} declares a file name that escapes its destination: ${file.name}`);
    }
  }
  if (!pack.approved) {
    failures.push(`${pack.id} declares a download but is not approved; it could never be fetched.`);
  }
}

if (failures.length) throw new Error(`Model-fetch policy failed:\n  - ${failures.join("\n  - ")}`);
console.log(
  `Model-fetch policy passed: 1 network-capable source held to HTTPS, an exact-match host ` +
  `allow-list and a verified digest; ${blocks} declared download blocks covering ${files} files, ` +
  `every one with a SHA-256 and a byte count.`,
);
