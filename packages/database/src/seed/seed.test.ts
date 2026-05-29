import { afterAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { testClient, withTestTransaction } from "../test-helpers";
import { modules, permissions } from "../schema";
import { seed } from "./index";

afterAll(async () => {
  await testClient.end();
});

/**
 * Regression guard (Task 1.1): the global seed must NOT create any CRM
 * (or other module) permission rows. Module permissions are seeded at
 * tenant activation, not by `pnpm db:seed`. Asserts a zero delta in
 * crm-module permission rows across a seed run so the removed Phase-2
 * placeholder block can't quietly return.
 */
describe("seed — module-permission regression guard", () => {
  test("running the seed creates zero CRM permission rows", async () => {
    await withTestTransaction(async (tx) => {
      async function crmPermCount(): Promise<number> {
        const [crm] = await tx
          .select({ id: modules.id })
          .from(modules)
          .where(eq(modules.slug, "crm"));
        if (!crm) return 0;
        const rows = await tx
          .select({ id: permissions.id })
          .from(permissions)
          .where(eq(permissions.moduleId, crm.id));
        return rows.length;
      }

      const before = await crmPermCount();
      await seed(tx);
      const after = await crmPermCount();

      expect(after - before).toBe(0);
    });
  });
});
