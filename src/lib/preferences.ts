import type { Profile } from "./types";

export const PREFERENCES_STORAGE_KEY = "philon.preferences.v2";

export const profiles: Array<{ name: Profile; description: string }> = [
  { name: "Fast", description: "Native text only when trustworthy." },
  { name: "Balanced", description: "Local evidence checks. No network." },
  { name: "Verified", description: "Stricter checks and more review signals." },
];

export const outputChoices = ["machine", "markdown", "html", "ir", "chunks", "evidence", "table_csv", "assets", "manifest", "marker_json"] as const;
export type OutputChoice = typeof outputChoices[number];
export type Preferences = { defaultProfile: Profile; cachePolicy: "use" | "refresh" | "bypass"; outputs: OutputChoice[]; enabledModelIds: string[] };
export const defaultPreferences: Preferences = { defaultProfile: "Balanced", cachePolicy: "use", outputs: outputChoices.filter((output) => output !== "marker_json"), enabledModelIds: [] };

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
    return { defaultProfile, cachePolicy, outputs: outputs.length ? outputs : [...defaultPreferences.outputs], enabledModelIds };
  } catch { return fallbackPreferences(); }
}

export function loadPreferences(): Preferences {
  try {
    return parsePreferences(localStorage.getItem(PREFERENCES_STORAGE_KEY));
  } catch { return fallbackPreferences(); }
}
