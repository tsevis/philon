import { readFile } from "node:fs/promises";

// engine/model_fetch.py is the one file tests/local-only-policy.mjs exempts, so
// the exemption is only as good as what this gate holds that file to. A file
// allowed to open connections and then trusted to be careful is not a policy.
//
// Five properties are checked in the source, and the manifest is checked
// against the same rules, because a download block naming an arbitrary host or
// carrying no digest would walk around all five. The fourth of them -- that the
// redirect check is reachable at all -- was added after a real fetch showed the
// module returning a 200 from a host its own allow-list refuses.

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

// 2a. The one rule that is not exact match. HuggingFace serves large files from
//     a per-region Xet CDN host that cannot be enumerated here, so hosts beneath
//     a named parent are allowed. That is only safe while the match is anchored
//     on a leading dot: `cdn.hf.co.example.invalid` ends with `cdn.hf.co` and
//     would pass an unanchored test, and does not end with `.cdn.hf.co`.
if (/MODEL_HOST_ALLOWED_PARENTS/.test(source)) {
  if (!/endswith\("\." \+ parent\)/.test(source)) {
    failures.push(
      "model_fetch.py matches an allowed parent domain without anchoring on a leading dot; " +
      "that accepts a look-alike such as cdn.hf.co.example.invalid.",
    );
  }
  const parents = /MODEL_HOST_ALLOWED_PARENTS\s*=\s*\(([^)]*)\)/.exec(source)?.[1] ?? "";
  for (const parent of parents.match(/"([^"]+)"/g) ?? []) {
    // A parent with one label is a public suffix: ".co" would allow the world.
    if (parent.replace(/"/g, "").split(".").length < 2) {
      failures.push(`model_fetch.py names ${parent} as an allowed parent; that is too broad to be a host.`);
    }
  }
}

// 3. HTTPS only, and every redirect hop re-checked rather than the first URL.
if (!/scheme\.lower\(\)\s*!=\s*"https"/.test(source)) {
  failures.push("model_fetch.py does not require HTTPS.");
}
if (!/for _ in range\(MAX_REDIRECTS/.test(source) || !/is_allowed_url\(current\)/.test(source)) {
  failures.push("model_fetch.py does not re-check each redirect hop against the allow-list.");
}

// 3a. And that the re-check is reachable. This is the property whose absence
//     made the loop above dead code: `urllib.request.urlopen` installs a
//     redirect handler that follows hops itself and returns only the final
//     response, so the allow-list covered the first URL and nothing after it.
//     A real fetch came back 200 from a host `is_allowed_url` refuses. The
//     module must therefore open through an opener built to refuse redirects,
//     and must not reach for `urlopen`, which cannot be given one.
if (/urllib\.request\.urlopen\s*\(/.test(source)) {
  failures.push(
    "model_fetch.py calls urllib.request.urlopen, which follows redirects itself; " +
    "the hand-written redirect check would never see a hop.",
  );
}
if (!/class\s+_RefuseRedirects\(urllib\.request\.HTTPRedirectHandler\)/.test(source)) {
  failures.push("model_fetch.py installs no handler that refuses to follow redirects.");
}
if (!/def redirect_request\([^)]*\):[^\n]*\n\s*return None/.test(source)) {
  failures.push("model_fetch.py's redirect handler does not refuse the hop by returning None.");
}
if (!/build_opener\(/.test(source) || !/opener\.open\(request/.test(source)) {
  failures.push("model_fetch.py does not open its connections through the opener it built.");
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
  `allow-list with dot-anchored parents, a redirect check that is reachable because the opener ` +
  `refuses to follow hops itself, and a verified digest; ${blocks} declared download blocks ` +
  `covering ${files} files, every one with a SHA-256 and a byte count.`,
);
