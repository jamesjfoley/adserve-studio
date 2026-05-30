import "dotenv/config";
import { db } from "@adserve/database";
import { reprovisionCrm } from "./reprovision";

/**
 * One-off runner for Task 1.9a. Reprovisions CRM-enabled tenants and
 * retires the Phase-2 placeholder permissions in a single transaction
 * (rolls back on any error — no partial state).
 *
 * Local dev: `pnpm --filter @adserve/crm reprovision-crm`.
 * Production: GATED — destructive (deletes live permission rows). Run only
 * with explicit approval, against the production DATABASE_URL.
 */
async function main() {
  console.log(
    "🔁 Reprovisioning CRM for existing tenants + retiring Phase-2 placeholders...\n"
  );
  const result = await db.transaction((tx) => reprovisionCrm(tx));
  console.log("✅ Done:\n");
  console.log(`   tenants reprovisioned:        ${result.tenantsReprovisioned}`);
  console.log(`   grants migrated (custom):     ${result.grantsMigrated}`);
  console.log(`   grants dropped (export):      ${result.grantsDroppedExport}`);
  console.log(`   grants dropped (ai.use):      ${result.grantsDroppedAi}`);
  console.log(`   grants dropped (CRM disabled):${result.grantsDroppedDisabledTenant}`);
  console.log(`   placeholder perms deleted:    ${result.placeholdersDeleted}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Reprovision failed:", err);
  process.exit(1);
});
