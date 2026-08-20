import { vi } from "vitest";
import type { ModelPack } from "../lib/types";

/**
 * The workspace only reaches the outside world through three Tauri modules.
 * Mocking them at the module boundary keeps component tests honest about what
 * the UI actually asks the local host to do.
 */
export const bridge = {
  invoke: vi.fn(),
  open: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) => bridge.invoke(command, args),
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    bridge.listeners.set(name, handler);
    return Promise.resolve(() => bridge.listeners.delete(name));
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (options?: Record<string, unknown>) => bridge.open(options),
}));

type Reply = unknown | ((args?: Record<string, unknown>) => unknown);
export type CommandReplies = Record<string, Reply>;

const baseReplies: CommandReplies = {
  list_jobs: [],
  latest_batch: null,
  list_batch_items: [],
};

/** Answer only the commands a test declares; anything else is a test bug. */
export function respondWith(replies: CommandReplies = {}) {
  const table: CommandReplies = { ...baseReplies, ...replies };
  bridge.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (!(command in table)) return Promise.reject(new Error(`Unexpected host command: ${command}`));
    const reply = table[command];
    const value = typeof reply === "function" ? (reply as (args?: Record<string, unknown>) => unknown)(args) : reply;
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  });
}

export function emit(event: string, payload: unknown) {
  bridge.listeners.get(event)?.({ payload });
}

export function callsTo(command: string) {
  return bridge.invoke.mock.calls.filter((call) => call[0] === command).map((call) => call[1] as Record<string, unknown> | undefined);
}

export function resetBridge() {
  bridge.invoke.mockReset();
  bridge.open.mockReset();
  bridge.listeners.clear();
}

export function modelPack(overrides: Partial<ModelPack> & Pick<ModelPack, "id">): ModelPack {
  return {
    role: "repair",
    required: false,
    approved: true,
    installed: false,
    license: "Apache-2.0",
    runtime: "local",
    distribution: "local",
    integrity: null,
    readiness: "ready",
    ...overrides,
  };
}
