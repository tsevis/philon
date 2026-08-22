export function basename(path: string) {
  return path.split("/").pop() || path;
}

export function bytesLabel(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function confidenceLabel(value: number) {
  if (value >= 0.9) return "High confidence";
  if (value >= 0.75) return "Review suggested";
  return "Needs review";
}

/**
 * A conversion's own recorded time, as the local machine would write it.
 *
 * `new Date(…).toLocaleString()` answers the string "Invalid Date" for
 * anything it cannot parse, which reads as a date to everything downstream
 * and tells the reader nothing about what Philon actually holds. A timestamp
 * that will not parse is shown as it was stored instead, and an absent one is
 * named as absent, because a record with no time is a fact about the record.
 */
export function timestampLabel(value: string | null | undefined) {
  if (!value) return "Date not recorded";
  const recorded = new Date(value);
  return Number.isNaN(recorded.getTime()) ? value : recorded.toLocaleString();
}

/** Schemes the exports will make clickable. A PDF may declare any URI. */
const anchorableSchemes = ["http://", "https://", "mailto:"];

export function isAnchorableLink(uri: string) {
  const target = uri.trim().toLowerCase();
  return anchorableSchemes.some((scheme) => target.startsWith(scheme));
}

/**
 * What the PDF's own link annotations came to on one block.
 *
 * A target the exports will not make clickable is still reported: it is
 * something the source declared, and saying nothing about it would hide a
 * decision Philon made rather than record it.
 */
export function linkSummary(links: Array<{ uri: string }> | undefined) {
  if (!links?.length) return "None declared";
  const anchored = links.filter((link) => isAnchorableLink(link.uri)).length;
  const withheld = links.length - anchored;
  if (!withheld) return `${anchored} anchored`;
  if (!anchored) return `${withheld} declared, none an anchorable scheme`;
  return `${anchored} anchored, ${withheld} withheld as unanchorable`;
}
