import { describe, expect, it } from "vitest";
import { defaultPreferences, outputChoices, parsePreferences } from "./preferences";

describe("parsePreferences", () => {
  it("returns the defaults when nothing has been stored", () => {
    expect(parsePreferences(null)).toEqual(defaultPreferences);
  });

  it("returns the defaults rather than throwing on corrupted storage", () => {
    expect(parsePreferences("{not json")).toEqual(defaultPreferences);
  });

  it("keeps a fully valid stored preference set", () => {
    const stored = { defaultProfile: "Verified", cachePolicy: "bypass", outputs: ["ir", "evidence"], enabledModelIds: ["local-repair"], modelSetupSeen: true };
    expect(parsePreferences(JSON.stringify(stored))).toEqual(stored);
  });

  it("treats an absent model-setup flag as a first run", () => {
    // An upgrade from a build without the field shows setup once, which is the
    // right answer: the packs it offers are new to that installation.
    expect(parsePreferences(JSON.stringify({ defaultProfile: "Fast" })).modelSetupSeen).toBe(false);
    expect(parsePreferences(null).modelSetupSeen).toBe(false);
  });

  it("only accepts the model-setup flag as a real boolean", () => {
    expect(parsePreferences(JSON.stringify({ modelSetupSeen: "yes" })).modelSetupSeen).toBe(false);
    expect(parsePreferences(JSON.stringify({ modelSetupSeen: 1 })).modelSetupSeen).toBe(false);
    expect(parsePreferences(JSON.stringify({ modelSetupSeen: true })).modelSetupSeen).toBe(true);
  });

  it("rejects a profile this build does not offer", () => {
    const parsed = parsePreferences(JSON.stringify({ defaultProfile: "Cloud" }));
    expect(parsed.defaultProfile).toBe(defaultPreferences.defaultProfile);
  });

  it("rejects a cache policy this build does not offer", () => {
    expect(parsePreferences(JSON.stringify({ cachePolicy: "remote" })).cachePolicy).toBe("use");
  });

  it("drops unknown output names instead of forwarding them to the engine", () => {
    const parsed = parsePreferences(JSON.stringify({ outputs: ["ir", "exfiltrate", "markdown"] }));
    expect(parsed.outputs).toEqual(["markdown", "ir"]);
  });

  it("restores the default outputs when every stored output is unknown", () => {
    // The engine rejects an empty output list, so an unusable selection must
    // never reach it.
    expect(parsePreferences(JSON.stringify({ outputs: ["exfiltrate"] })).outputs).toEqual(defaultPreferences.outputs);
    expect(parsePreferences(JSON.stringify({ outputs: [] })).outputs).toEqual(defaultPreferences.outputs);
  });

  it("returns outputs in this build's canonical order", () => {
    const parsed = parsePreferences(JSON.stringify({ outputs: ["evidence", "machine"] }));
    expect(parsed.outputs).toEqual(["machine", "evidence"]);
  });

  it("drops non-string model ids", () => {
    const parsed = parsePreferences(JSON.stringify({ enabledModelIds: ["local-repair", 7, null, { id: "x" }] }));
    expect(parsed.enabledModelIds).toEqual(["local-repair"]);
  });

  it("ignores a stored value of the wrong shape entirely", () => {
    const parsed = parsePreferences(JSON.stringify({ outputs: "markdown", enabledModelIds: "local-repair" }));
    expect(parsed.outputs).toEqual(defaultPreferences.outputs);
    expect(parsed.enabledModelIds).toEqual([]);
  });

  it("never hands back the shared default arrays for a caller to mutate", () => {
    const first = parsePreferences(null);
    first.outputs.push("page_tree");
    expect(parsePreferences(null).outputs).toEqual(defaultPreferences.outputs);
    expect(defaultPreferences.outputs).not.toContain("page_tree");
  });

  it("leaves the compatibility output off by default", () => {
    expect(defaultPreferences.outputs).not.toContain("page_tree");
    expect(outputChoices).toContain("page_tree");
  });
});
