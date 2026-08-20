import { readFile } from "node:fs/promises";

const allowed = new Set(["BSD-3-Clause / Apache-2.0", "Apple platform runtime"]);
const manifest = JSON.parse(await readFile(new URL("../engine/model-manifest.json", import.meta.url), "utf8"));
const invalid = manifest.packs.filter((pack) => pack.required && !allowed.has(pack.license));
const missingGovernance = manifest.packs.filter((pack) => typeof pack.approved !== "boolean" || !pack.distribution);

if (invalid.length) {
  throw new Error(`Required model packs lack an approved licence: ${invalid.map((pack) => pack.id).join(", ")}`);
}
if (missingGovernance.length) {
  throw new Error(`Model packs need approval and distribution metadata: ${missingGovernance.map((pack) => pack.id).join(", ")}`);
}

console.log(`License policy passed for ${manifest.packs.length} declared model packs.`);
