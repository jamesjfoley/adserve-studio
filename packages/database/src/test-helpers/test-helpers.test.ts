import { describe, test, expect } from "vitest";
import { eq } from "drizzle-orm";
import { tenants } from "../schema/tenants";
import {
  createTestTenant,
  setupTestContext,
  withTestTransaction,
} from "./index";

/**
 * Smoke tests for the test harness itself. If these pass, the
 * transaction-rollback pattern + tenant creation helpers are working
 * and other tasks can copy from here.
 */
describe("test harness smoke tests", () => {
  test("withTestTransaction rolls back writes", async () => {
    let createdTenantId: string | null = null;
    await withTestTransaction(async (tx) => {
      const tenant = await createTestTenant(tx);
      createdTenantId = tenant.id;

      // Visible inside the tx
      const inside = await tx
        .select()
        .from(tenants)
        .where(eq(tenants.id, tenant.id));
      expect(inside).toHaveLength(1);
    });

    // After the tx rolls back, the row should not exist when queried
    // from a fresh transaction.
    expect(createdTenantId).not.toBeNull();
    await withTestTransaction(async (tx) => {
      const after = await tx
        .select()
        .from(tenants)
        .where(eq(tenants.id, createdTenantId!));
      expect(after).toHaveLength(0);
    });
  });

  test("setupTestContext creates tenant + user + role + membership", async () => {
    await withTestTransaction(async (tx) => {
      const ctx = await setupTestContext(tx);

      expect(ctx.tenant.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(ctx.user.email).toContain("@example.com");
      expect(ctx.role.slug).toBe("owner");
    });
  });

  test("withTestTransaction returns the callback's value", async () => {
    const result = await withTestTransaction(async (tx) => {
      const tenant = await createTestTenant(tx, { name: "Returned Tenant" });
      return { foundName: tenant.name };
    });
    expect(result).toEqual({ foundName: "Returned Tenant" });
  });
});
