import { describe, test, expect } from "vitest";
import {
  withTestTransaction,
  setupTestContext,
} from "@adserve/database/test-helpers";
import {
  createFieldDefinition,
  deleteFieldDefinition,
  coerceFieldValue,
} from "../src/field-engine";

/**
 * Skeleton tests for the field definition engine. These document the
 * contract from Task 0.2 of docs/phase-3-plan.md.
 *
 * They use `test.fails()` — vitest's "expected to fail" wrapper. While
 * Task 0.2 is unimplemented, each stub throws and the test "fails" — but
 * because we declared `test.fails()`, the failure is treated as success.
 *
 * The moment Task 0.2 lands and these stubs start passing, `test.fails()`
 * inverts: the now-passing test will be reported as a failure, alerting
 * the developer to convert each one to a regular `test()` with real
 * assertions. That's the handoff.
 *
 * Each test creates a fresh tenant inside a transaction that always
 * rolls back, so they can run in any order against any database.
 */
describe("field definition engine", () => {
  test.fails("creates a field definition with a valid type", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);

      // TODO(task-0.2): pass a real entity type id once entity registry exists.
      // For now this test will throw inside createFieldDefinition.
      const field = await createFieldDefinition(tx, {
        tenantId: tenant.id,
        entityTypeId: "00000000-0000-0000-0000-000000000000",
        name: "Annual Revenue",
        slug: "annual_revenue",
        fieldType: "currency",
        labels: { en: "Annual Revenue" },
      });

      expect(field).toMatchObject({
        tenantId: tenant.id,
        slug: "annual_revenue",
        fieldType: "currency",
      });
      expect(field.id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  test.fails("coerces values to the declared type on write", async () => {
    // Pure function, no DB needed. Verifies that writing a string "42"
    // to a number-typed field becomes 42, etc.
    expect(await coerceFieldValue("number", "42")).toBe(42);
    expect(await coerceFieldValue("number", 42)).toBe(42);
    expect(await coerceFieldValue("boolean", "true")).toBe(true);
    expect(await coerceFieldValue("boolean", false)).toBe(false);

    // Invalid coercions should throw, not silently coerce to NaN/null.
    await expect(coerceFieldValue("number", "not a number")).rejects.toThrow();
  });

  test.fails("refuses to delete a system field without force flag", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);

      const field = await createFieldDefinition(tx, {
        tenantId: tenant.id,
        entityTypeId: "00000000-0000-0000-0000-000000000000",
        name: "Name",
        slug: "name",
        fieldType: "text",
        isSystem: true,
      });

      await expect(
        deleteFieldDefinition(tx, {
          fieldId: field.id,
          tenantId: tenant.id,
        })
      ).rejects.toThrow(/system field/i);
    });
  });

  test.fails("refuses to delete a field that has populated record data", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);

      const field = await createFieldDefinition(tx, {
        tenantId: tenant.id,
        entityTypeId: "00000000-0000-0000-0000-000000000000",
        name: "Notes",
        slug: "notes",
        fieldType: "textarea",
      });

      // TODO(task-0.2): once the records helper exists, write a record
      // with data.notes populated, then attempt the delete.
      // For now this asserts the not-implemented stub throws, which
      // signals the test still needs fleshing out at implementation time.
      await expect(
        deleteFieldDefinition(tx, {
          fieldId: field.id,
          tenantId: tenant.id,
        })
      ).rejects.toThrow();
    });
  });
});
