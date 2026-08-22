import { describe, expect, it } from "vitest";
import { basename, bytesLabel, confidenceLabel, isAnchorableLink, linkSummary, timestampLabel } from "./format";

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
