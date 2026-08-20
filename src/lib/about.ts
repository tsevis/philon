/**
 * What Philon is, who it is named after, and what it owes.
 *
 * Shown once at launch and reachable afterwards. A splash screen is unusual,
 * and this one earns its place by carrying the thing that has to be carried:
 * Philon's promise is that nothing leaves the machine and that no text is
 * invented, and the first launch is exactly when that is worth reading.
 *
 * The text is data with tests on it rather than strings typed into a
 * component, so a claim cannot go missing without a test noticing.
 */
export const TITLE = "Philon";
export const SUBTITLE = "Documents converted with their evidence intact";
export const VERSION = __APP_VERSION__;

export const ABOUT = `Philon of Alexandria spent his life reading one tradition in the language of \
another. Writing in Greek in the first century, he worked through the Hebrew scriptures a passage \
at a time — quoting the line, then drawing out what he took it to mean — and he held that the \
literal sense had to stand even where the allegory moved him most, against contemporaries content \
to let the reading replace the text.

This is a small tribute to that discipline. A conversion is a reading: a PDF becomes Markdown only \
because something decided what was a heading, what was a table, and what the letters were. Philon \
keeps the source beside the reading — every block carries its page, its method, its confidence and \
what was checked — and marks what it cannot settle instead of smoothing it into fluent text nobody \
can go back and verify.`;

export const CREDIT = "Created by Charis Tsevis, with the help of Claude Code.";

export const LINKS: ReadonlyArray<readonly [string, string]> = [
  ["tsevis.com", "https://tsevis.com"],
  ["github.com/tsevis", "https://github.com/tsevis"],
];

/**
 * The obligations and the sources.
 *
 * The key art line names what the picture actually is. A picture on the front
 * of a program is a claim, and this one is an engraving rather than the
 * program's own output — so it says so.
 */
export const LEGAL = `The engraving above is a detail of an antique portrait plate: a robed scholar \
holding a closed book.

Extraction uses PDFium through pypdfium2 (BSD-3-Clause) and pypdf (BSD-3-Clause); images through \
Pillow (HPND). On-device recognition is Apple Vision, a macOS system framework. The desktop shell \
is Tauri (Apache-2.0 OR MIT), with SQLite (public domain) through rusqlite. Interface icons are \
Phosphor (MIT). Every declared component, and whether it ships or only builds and tests, is listed \
in SBOM.cdx.json.

Philon does not reuse Marker code or models. Optional local model packs stay off until you enable \
them, and a pack whose licence has not been approved cannot be enabled at all.

Your documents are yours. Philon never sends a document, a fragment or a filename anywhere.`;
