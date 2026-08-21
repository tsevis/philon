// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function Throws({ failing }: { failing: boolean }): JSX.Element {
  if (failing) throw new Error("Cannot read properties of undefined (reading 'split')");
  return <p>The workspace</p>;
}

beforeEach(() => {
  // React reports a caught render failure on the console. The boundary is the
  // subject here, so the report is silenced rather than left to look like a
  // failing run.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("a surface that fails to render", () => {
  it("leaves the window with something in it", () => {
    render(<ErrorBoundary><Throws failing /></ErrorBoundary>);
    expect(screen.getByRole("alert")).not.toBeNull();
  });

  it("says what went wrong, rather than showing nothing", () => {
    render(<ErrorBoundary><Throws failing /></ErrorBoundary>);
    expect(screen.getByText(/reading 'split'/)).not.toBeNull();
  });

  it("says the documents were left alone", () => {
    render(<ErrorBoundary><Throws failing /></ErrorBoundary>);
    expect(screen.getByText(/untouched/)).not.toBeNull();
  });

  it("can rebuild the workspace once the cause is gone", () => {
    const { rerender } = render(<ErrorBoundary><Throws failing /></ErrorBoundary>);
    rerender(<ErrorBoundary><Throws failing={false} /></ErrorBoundary>);
    fireEvent.click(screen.getByRole("button", { name: /Reload the workspace/i }));
    expect(screen.getByText("The workspace")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stays out of the way while nothing is wrong", () => {
    render(<ErrorBoundary><Throws failing={false} /></ErrorBoundary>);
    expect(screen.getByText("The workspace")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
