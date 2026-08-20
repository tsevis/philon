import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Pure workspace logic runs in a plain Node environment. Component tests opt
// into jsdom with a `@vitest-environment jsdom` docblock, so the fast unit
// tests never pay for a DOM.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    reporters: "default",
  },
});
