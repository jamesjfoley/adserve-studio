import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Load apps/web/.env.local into process.env. This module is imported by the
// runner AND each worker, so the Clerk keys + E2E creds are visible everywhere
// (env vars set only in globalSetup do NOT propagate to worker processes).
// Existing env wins, so CI secrets are never overwritten.
(function loadEnvLocal() {
  try {
    const file = path.resolve(__dirname, ".env.local");
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (process.env[key] !== undefined) continue;
      process.env[key] = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  } catch {
    // Rely on the ambient environment / CI secrets.
  }
})();

// dev runs as the DB superuser (RLS off) — fine here: these specs exercise only
// nav chrome (no tenant-scoped reads); the RLS bar is owned by the vitest suite.
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;
const STORAGE_STATE = path.resolve(__dirname, "e2e/.auth/user.json");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Generous per-test timeout: a cold `next dev` compiles routes on first hit
  // and the Clerk sign-in FAPI round-trip can be slow on a fresh server.
  timeout: 60_000,
  reporter: [["list"]],
  use: { baseURL: BASE_URL, trace: "on-first-retry" },
  projects: [
    // Signs in once via @clerk/testing and saves the authenticated session.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
