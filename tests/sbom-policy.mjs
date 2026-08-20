import { readFile } from "node:fs/promises";

const bom = JSON.parse(await readFile(new URL("../SBOM.cdx.json", import.meta.url), "utf8"));
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const cargo = await readFile(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");

if (bom.bomFormat !== "CycloneDX" || !Array.isArray(bom.components) || bom.components.length < 4) {
  throw new Error("SBOM must be a populated CycloneDX document.");
}

const DISTRIBUTIONS = { shipped: "required", "build-only": "excluded", "test-only": "excluded" };
// A copyleft build tool is fine; a copyleft component inside the shipped app
// is a licence decision, not an oversight. Keep the two apart mechanically.
const COPYLEFT = /^(GPL|AGPL|LGPL|SSPL)/i;

const distributionOf = new Map();
for (const component of bom.components) {
  const where = `SBOM component ${component.name || "(unnamed)"}`;
  if (!component.name || typeof component.version !== "string" || !component.version) {
    throw new Error(`${where} must declare a name and a resolved version.`);
  }
  if (!Array.isArray(component.licenses) || !component.licenses.length) {
    throw new Error(`${where} must declare a licence.`);
  }
  const distribution = component.properties?.find((property) => property.name === "philon:distribution")?.value;
  if (!(distribution in DISTRIBUTIONS)) {
    throw new Error(`${where} must declare philon:distribution as one of ${Object.keys(DISTRIBUTIONS).join(", ")}.`);
  }
  if (component.scope !== DISTRIBUTIONS[distribution]) {
    throw new Error(`${where} is ${distribution}, so its CycloneDX scope must be ${DISTRIBUTIONS[distribution]}.`);
  }
  const licence = component.licenses.map((entry) => entry.expression || entry.license?.id || "").join(" OR ");
  if (distribution === "shipped" && COPYLEFT.test(licence)) {
    throw new Error(`${where} ships under ${licence}. A copyleft runtime component needs an explicit licence decision.`);
  }
  distributionOf.set(component.name, distribution);
}

for (const required of ["pypdfium2", "pypdf", "Pillow", "tauri"]) {
  if (!distributionOf.has(required)) throw new Error(`SBOM is missing ${required}.`);
}

// Every npm package this project depends on must be accounted for, so adding a
// dependency without declaring it fails here rather than after release.
for (const [name] of Object.entries(manifest.dependencies || {})) {
  if (distributionOf.get(name) !== "shipped") {
    throw new Error(`${name} is a runtime dependency but is not declared as a shipped SBOM component.`);
  }
}
for (const [name] of Object.entries(manifest.devDependencies || {})) {
  const distribution = distributionOf.get(name);
  if (!distribution) throw new Error(`${name} is a devDependency but is not declared in the SBOM.`);
  if (distribution === "shipped") throw new Error(`${name} is a devDependency but the SBOM declares it as shipped.`);
}

/** Read one dependency table out of the hand-written Cargo manifest. */
function cargoTable(name) {
  const section = cargo.split(/^\[/m).find((block) => block.startsWith(`${name}]`));
  if (!section) return [];
  return section
    .split("\n")
    .slice(1)
    .map((line) => line.match(/^([A-Za-z0-9_-]+)\s*=/)?.[1])
    .filter((crate) => Boolean(crate));
}

for (const crate of cargoTable("dependencies")) {
  if (distributionOf.get(crate) !== "shipped") {
    throw new Error(`${crate} is a Cargo dependency but is not declared as a shipped SBOM component.`);
  }
}
for (const crate of cargoTable("build-dependencies")) {
  const distribution = distributionOf.get(crate);
  if (!distribution) throw new Error(`${crate} is a Cargo build-dependency but is not declared in the SBOM.`);
  if (distribution === "shipped") throw new Error(`${crate} is a Cargo build-dependency but the SBOM declares it as shipped.`);
}

const counts = [...distributionOf.values()].reduce((totals, value) => ({ ...totals, [value]: (totals[value] || 0) + 1 }), {});
console.log(`SBOM policy passed for ${bom.components.length} declared components (${Object.entries(counts).map(([key, value]) => `${value} ${key}`).join(", ")}).`);
