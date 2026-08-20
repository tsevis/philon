import { describe, expect, it } from "vitest";
import { basename, bytesLabel, confidenceLabel } from "./format";

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
