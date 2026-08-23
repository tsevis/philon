import { describe, expect, it } from "vitest";
import { basename, bytesLabel, confidenceLabel, isAnchorableLink, linkSummary, measuredFormulaSummary, ruledTableSummary, timestampLabel } from "./format";

describe("basename", () => {
  it("names the document rather than its containing path", () => {
    expect(basename("/Users/someone/Documents/paper.pdf")).toBe("paper.pdf");
  });

  it("keeps a bare filename unchanged", () => {
    expect(basename("paper.pdf")).toBe("paper.pdf");
  });

  it("falls back to the original string when a path ends in a separator", () => {
    expect(basename("/Users/someone/Documents/")).toBe("/Users/someone/Documents/");
  });

  it("keeps an empty path displayable", () => {
    expect(basename("")).toBe("");
  });
});

describe("bytesLabel", () => {
  it("reports sub-megabyte sizes in kilobytes", () => {
    expect(bytesLabel(2048)).toBe("2 KB");
  });

  it("never reports a non-empty file as 0 KB", () => {
    expect(bytesLabel(1)).toBe("1 KB");
  });

  it("switches to megabytes at the one-megabyte boundary", () => {
    expect(bytesLabel(1024 * 1024 - 1)).toBe("1024 KB");
    expect(bytesLabel(1024 * 1024)).toBe("1.0 MB");
  });

  it("keeps one decimal place for larger documents", () => {
    expect(bytesLabel(5 * 1024 * 1024 + 512 * 1024)).toBe("5.5 MB");
  });
});

describe("confidenceLabel", () => {
  it("does not claim high confidence below the review threshold", () => {
    expect(confidenceLabel(0.9)).toBe("High confidence");
    expect(confidenceLabel(0.8999)).toBe("Review suggested");
  });

  it("asks for review when confidence drops under the suggestion threshold", () => {
    expect(confidenceLabel(0.75)).toBe("Review suggested");
    expect(confidenceLabel(0.7499)).toBe("Needs review");
  });

  it("treats an unmeasured block as needing review", () => {
    expect(confidenceLabel(0)).toBe("Needs review");
  });
});

describe("timestampLabel", () => {
  it("reads the RFC 3339 time the local database records", () => {
    // Formatted for whichever locale the Mac is set to, so this asserts that
    // the moment survived rather than how it happened to be spelled.
    expect(timestampLabel("2026-01-01T00:00:00Z")).toBe(new Date("2026-01-01T00:00:00Z").toLocaleString());
  });

  it("never shows the reader the string \"Invalid Date\"", () => {
    for (const unparseable of ["", "not-a-date", "0000-00-00", undefined, null]) {
      expect(timestampLabel(unparseable)).not.toBe("Invalid Date");
    }
  });

  it("shows an unparseable timestamp as it was actually stored", () => {
    expect(timestampLabel("not-a-date")).toBe("not-a-date");
  });

  it("names an absent timestamp as absent", () => {
    expect(timestampLabel(undefined)).toBe("Date not recorded");
    expect(timestampLabel(null)).toBe("Date not recorded");
    expect(timestampLabel("")).toBe("Date not recorded");
  });
});

describe("isAnchorableLink", () => {
  it("accepts the schemes the exports will make clickable", () => {
    for (const uri of ["https://a.test/x", "http://a.test/x", "MailTo:someone@a.test"]) expect(isAnchorableLink(uri)).toBe(true);
  });

  it("refuses anything else a PDF may declare", () => {
    for (const uri of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,<b>", "", "  "]) expect(isAnchorableLink(uri)).toBe(false);
  });
});

describe("ruledTableSummary", () => {
  it("says so when the page ruled nothing", () => {
    expect(ruledTableSummary(undefined, undefined)).toBe("None ruled");
    expect(ruledTableSummary(undefined, { ruled_tables: [] })).toBe("None ruled");
  });

  it("names the grid the selected block was recovered from", () => {
    expect(ruledTableSummary({ table: { row_count: 3, column_count: 4 } }, { ruled_tables: [{ recoverable: true }] }))
      .toBe("3 × 4 recovered from ruled geometry");
  });

  it("counts what the page recovered when the block is not a table", () => {
    expect(ruledTableSummary(undefined, { ruled_tables: [{ recoverable: true }, { recoverable: true }] }))
      .toBe("2 recovered on this page");
  });

  it("reports a lattice no table can hold rather than hiding it", () => {
    expect(ruledTableSummary(undefined, { ruled_tables: [{ recoverable: false }] }))
      .toBe("1 ruled, none a shape a table can hold");
    expect(ruledTableSummary(undefined, { ruled_tables: [{ recoverable: true }, { recoverable: false }] }))
      .toBe("1 recovered, 1 not recoverable");
  });

  it("names the merged cells the page's missing rules proved", () => {
    const spans = [[{ rowspan: 1, colspan: 2 }, null], [{ rowspan: 1, colspan: 1 }, { rowspan: 1, colspan: 1 }]];
    expect(ruledTableSummary({ table: { row_count: 2, column_count: 2, spans } }, undefined))
      .toBe("2 × 2 recovered from ruled geometry, 1 merged");
  });
});

describe("measuredFormulaSummary", () => {
  it("says so when nothing was measured", () => {
    expect(measuredFormulaSummary(undefined)).toBe("Not measured");
    expect(measuredFormulaSummary({ evidence: { findings: {} } })).toBe("None measured");
  });

  it("names a formula recovered from the page's own script geometry", () => {
    expect(measuredFormulaSummary({ formula: { typeset: "E = mc^{2}" }, evidence: { findings: { measured_script_count: 1 } } }))
      .toBe("Recovered with 1 measured script");
  });

  it("reports scripts it measured on a block that is not a formula", () => {
    expect(measuredFormulaSummary({ evidence: { findings: { measured_script_count: 2 } } }))
      .toBe("2 measured scripts, not a formula");
  });

  it("reports a mathematical face on its own", () => {
    expect(measuredFormulaSummary({ evidence: { findings: { set_in_mathematical_face: true } } }))
      .toBe("Set in a mathematical face");
  });
});

describe("linkSummary", () => {
  it("says so when the source declared none", () => {
    expect(linkSummary(undefined)).toBe("None declared");
    expect(linkSummary([])).toBe("None declared");
  });

  it("counts the anchored ones", () => {
    expect(linkSummary([{ uri: "https://a.test" }])).toBe("1 anchored");
  });

  it("names a withheld target rather than dropping it silently", () => {
    expect(linkSummary([{ uri: "javascript:x" }])).toBe("1 declared, none an anchorable scheme");
    expect(linkSummary([{ uri: "https://a.test" }, { uri: "file:///x" }])).toBe("1 anchored, 1 withheld as unanchorable");
  });
});
