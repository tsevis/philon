import type { Profile } from "./types";

export const PREFERENCES_STORAGE_KEY = "philon.preferences.v2";

export const profiles: Array<{ name: Profile; description: string }> = [
  { name: "Fast", description: "Native text only when trustworthy." },
  { name: "Balanced", description: "Local evidence checks. No network." },
  { name: "Verified", description: "Stricter checks and more review signals." },
];

export const outputChoices = ["machine", "markdown", "html", "ir", "chunks", "evidence", "table_csv", "assets", "manifest", "page_tree"] as const;
export type OutputChoice = typeof outputChoices[number];
export type Preferences = { defaultProfile: Profile; cachePolicy: "use" | "refresh" | "bypass"; outputs: OutputChoice[]; enabledModelIds: string[]; modelSetupSeen: boolean };
export const defaultPreferences: Preferences = { defaultProfile: "Balanced", cachePolicy: "use", outputs: outputChoices.filter((output) => output !== "page_tree"), enabledModelIds: [], modelSetupSeen: false };

function fallbackPreferences(): Preferences {
  return { ...defaultPreferences, outputs: [...defaultPreferences.outputs], enabledModelIds: [] };
}

/**
 * Stored preferences are untrusted input: they survive upgrades and can be
 * edited by hand. Every field is re-validated against the values this build
 * understands, and anything unrecognised falls back to the default.
 */
export function parsePreferences(raw: string | null): Preferences {
  try {
    const stored = JSON.parse(raw || "{}") as Partial<Preferences>;
    const defaultProfile = profiles.some((item) => item.name === stored.defaultProfile) ? stored.defaultProfile! : defaultPreferences.defaultProfile;
    const cachePolicy = stored.cachePolicy === "refresh" || stored.cachePolicy === "bypass" ? stored.cachePolicy : "use";
    const outputs = Array.isArray(stored.outputs) ? outputChoices.filter((item) => stored.outputs?.includes(item)) : [...defaultPreferences.outputs];
    const enabledModelIds = Array.isArray(stored.enabledModelIds) ? stored.enabledModelIds.filter((item): item is string => typeof item === "string") : [];
    // Absent means this build has not shown model setup yet, which is what a
    // first run is. An upgrade from a build without the field therefore shows
    // it once, which is the right answer: those packs are new.
    const modelSetupSeen = stored.modelSetupSeen === true;
    return { defaultProfile, cachePolicy, outputs: outputs.length ? outputs : [...defaultPreferences.outputs], enabledModelIds, modelSetupSeen };
  } catch { return fallbackPreferences(); }
}

export function loadPreferences(): Preferences {
  try {
    return parsePreferences(localStorage.getItem(PREFERENCES_STORAGE_KEY));
  } catch { return fallbackPreferences(); }
}
