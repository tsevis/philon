// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Splash } from "./Splash";
import { CREDIT, SUBTITLE, VERSION } from "./lib/about";

afterEach(cleanup);

describe("Splash", () => {
  it("shows the name, the line under it, and the version", () => {
    render(<Splash onDismiss={() => {}} />);
    expect(screen.getByRole("heading", { name: "Philon" })).not.toBeNull();
    expect(screen.getByText(SUBTITLE)).not.toBeNull();
    expect(screen.getByText(VERSION)).not.toBeNull();
  });

  it("carries the credit and both links", () => {
    render(<Splash onDismiss={() => {}} />);
    expect(screen.getByText(CREDIT)).not.toBeNull();
    expect(screen.getByRole("link", { name: "tsevis.com" }).getAttribute("href")).toBe("https://tsevis.com");
    expect(screen.getByRole("link", { name: "github.com/tsevis" }).getAttribute("href")).toBe("https://github.com/tsevis");
  });

  it("keeps the licences one disclosure away rather than in the reader's face", () => {
    render(<Splash onDismiss={() => {}} />);
    const disclosure = screen.getByText(/Sources, licences and credits/i).closest("details");
    expect(disclosure).not.toBeNull();
    expect((disclosure as HTMLDetailsElement).open).toBe(false);
  });

  it("is a modal dialog labelled by its own title", () => {
    render(<Splash onDismiss={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("splash-title");
  });

  it("treats Continue, Escape and the backdrop as the same thing", () => {
    for (const dismiss of [
      () => fireEvent.click(screen.getByRole("button", { name: "Continue" })),
      () => fireEvent.keyDown(window, { key: "Escape" }),
    ]) {
      const onDismiss = vi.fn();
      render(<Splash onDismiss={onDismiss} />);
      dismiss();
      expect(onDismiss).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it("does not dismiss when the dialog itself is clicked", () => {
    const onDismiss = vi.fn();
    render(<Splash onDismiss={onDismiss} />);
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
