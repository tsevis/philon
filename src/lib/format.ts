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

/**
 * What the page's own rules came to, for the block a reviewer has selected.
 *
 * A lattice that does not close is counted rather than hidden. It is the case
 * where Philon found the shape of a table and refused to guess its cells, and
 * a reviewer looking for a table that did not arrive should be told that is
 * what happened rather than left to conclude nothing was found.
 */
export function ruledTableSummary(
  block: { table?: { row_count: number; column_count: number; spans?: Array<Array<{ rowspan: number; colspan: number } | null>> } | null } | undefined,
  page: { ruled_tables?: Array<{ recoverable: boolean }> } | undefined,
) {
  if (block?.table) {
    const merged = (block.table.spans ?? []).flat().filter((span) => span && (span.rowspan > 1 || span.colspan > 1)).length;
    const size = `${block.table.row_count} × ${block.table.column_count} recovered from ruled geometry`;
    return merged ? `${size}, ${merged} merged` : size;
  }
  const grids = page?.ruled_tables ?? [];
  if (!grids.length) return "None ruled";
  const recovered = grids.filter((grid) => grid.recoverable).length;
  const open = grids.length - recovered;
  if (!open) return `${recovered} recovered on this page`;
  if (!recovered) return `${open} ruled, none a shape a table can hold`;
  return `${recovered} recovered, ${open} not recoverable`;
}

/**
 * What the page's own script geometry made of the selected block.
 *
 * A block with measured scripts that is not a formula still says so: the
 * measurement was taken and is part of what Philon knows about the block, and
 * reporting it only where it changed the output would hide the rest.
 */
export function measuredFormulaSummary(
  block: { type?: string; formula?: { typeset: string } | null; evidence?: { findings?: Record<string, unknown> } } | undefined,
) {
  if (!block) return "Not measured";
  const scripts = Number(block.evidence?.findings?.measured_script_count ?? 0);
  if (block.formula) return `Recovered with ${scripts} measured script${scripts === 1 ? "" : "s"}`;
  if (block.evidence?.findings?.set_in_mathematical_face) return "Set in a mathematical face";
  if (scripts) return `${scripts} measured script${scripts === 1 ? "" : "s"}, not a formula`;
  return "None measured";
}

/**
 * What a model pack would cost to fetch, from the manifest alone.
 *
 * Never asked of a host: Philon reports what it has been told a pack weighs,
 * so a person can see the cost of a download before any connection is opened.
 */
export function packDownloadLabel(pack: { downloadable?: boolean; download_bytes?: number | null; download_verified?: boolean }) {
  if (!pack.downloadable) return null;
  const bytes = pack.download_bytes ?? 0;
  const size = bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
  return pack.download_verified ? `${size}, checked against a SHA-256` : `${size}, no digest declared`;
}

/**
 * One line describing what a first run found, and what it would have to fetch.
 *
 * Counts packs a person can act on, so the built-in runtimes and the packs
 * policy blocks are left out of both halves rather than padding the good news.
 */
export function modelSetupSummary(packs: Array<{ required?: boolean; approved?: boolean; available_locally?: boolean; downloadable?: boolean }>) {
  const optional = packs.filter((pack) => !pack.required && pack.approved);
  if (!optional.length) return "No optional model packs are approved for this build.";
  const present = optional.filter((pack) => pack.available_locally).length;
  const fetchable = optional.filter((pack) => !pack.available_locally && pack.downloadable).length;
  if (!fetchable) return `${present} of ${optional.length} approved packs are already on this machine.`;
  return `${present} of ${optional.length} approved packs are already on this machine; ${fetchable} can be downloaded.`;
}
