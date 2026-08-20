import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Pure workspace logic runs in a plain Node environment. Component tests opt
// into jsdom with a `@vitest-environment jsdom` docblock, so the fast unit
// tests never pay for a DOM.
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    reporters: "default",
  },
});
