import { describe, expect, it } from "vitest";
import { ABOUT, CREDIT, LEGAL, LINKS, SUBTITLE, TITLE, VERSION } from "./about";

describe("about text", () => {
  it("names who the application is named after", () => {
    expect(ABOUT).toContain("Philon of Alexandria");
  });

  it("says what a conversion actually is", () => {
    expect(ABOUT).toMatch(/A conversion is a reading/i);
  });

  it("keeps the promise that nothing is invented", () => {
    expect(ABOUT).toMatch(/marks what it cannot settle/i);
  });

  it("carries the local-only promise where a first-time reader will see it", () => {
    expect(LEGAL).toMatch(/never sends a document, a fragment or a filename anywhere/i);
  });

  it("says what the key art is, because a picture on the front is a claim", () => {
    expect(LEGAL).toMatch(/engraving above/i);
  });

  it("credits the libraries whose licences ask to be named", () => {
    for (const owed of ["pypdfium2", "pypdf", "Pillow", "Tauri", "SQLite", "Phosphor"]) {
      expect(LEGAL).toContain(owed);
    }
  });

  it("states the model-pack policy rather than implying it", () => {
    expect(LEGAL).toMatch(/licence has not been approved cannot be enabled/i);
  });

  it("carries a title, a subtitle, a version and a credit", () => {
    expect(TITLE).toBe("Philon");
    expect(SUBTITLE.length).toBeGreaterThan(10);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(CREDIT).toContain("Charis Tsevis");
  });

  it("links only over https", () => {
    expect(LINKS.length).toBeGreaterThan(0);
    for (const [label, address] of LINKS) {
      expect(label).toBeTruthy();
      expect(address).toMatch(/^https:\/\//);
    }
  });
});
