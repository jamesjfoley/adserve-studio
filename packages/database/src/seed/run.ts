import "dotenv/config";
import { migrationClient } from "../client";
import { seed } from "./index";

/**
 * Entry point for `pnpm db:seed`. Kept separate from `./index.ts` so the
 * seed logic can be imported and exercised in tests without triggering a
 * real run / `process.exit`.
 */
seed()
  .then(async () => {
    await migrationClient.end();
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  });
