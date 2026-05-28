import { afterAll, describe, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  createTestEntityType,
  getModuleBySlug,
  setupTestContext,
  testClient,
  withTestTransaction,
} from "@adserve/database/test-helpers";
import { fieldDefinitions, records } from "@adserve/database";
import {
  coerceFieldValue,
  createFieldDefinition,
  deleteFieldDefinition,
  FieldDefinitionError,
  listFieldDefinitions,
  updateFieldDefinition,
} from "../src/field-engine";
import type { FieldType } from "../src/types";

// Close the test postgres client when this file's tests are done so the
// vitest process exits cleanly instead of hanging on the open pool.
afterAll(async () => {
  await testClient.end();
});

// ============================================================
// DB-side engine tests
// ============================================================
describe("field engine — createFieldDefinition", () => {
  test("creates a field definition with auto-populated en label", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");
      const entityType = await createTestEntityType(tx, {
        tenantId: tenant.id,
        moduleId: mod.id,
      });

      const field = await createFieldDefinition(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        name: "Annual Revenue",
        slug: "annual_revenue",
        fieldType: "currency",
      });

      expect(field.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(field.tenantId).toBe(tenant.id);
      expect(field.slug).toBe("annual_revenue");
      expect(field.fieldType).toBe("currency");
      // labels.en auto-filled from name
      expect(field.labels).toEqual({ en: "Annual Revenue" });
    });
  });

  test("explicit labels merge with auto-filled en", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");
      const entityType = await createTestEntityType(tx, {
        tenantId: tenant.id,
        moduleId: mod.id,
      });

      const field = await createFieldDefinition(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        name: "Website",
        slug: "website",
        fieldType: "url",
        labels: { fr: "Site Web" },
      });

      expect(field.labels).toEqual({ en: "Website", fr: "Site Web" });
    });
  });

  test("rejects an invalid field type", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");
      const entityType = await createTestEntityType(tx, {
        tenantId: tenant.id,
        moduleId: mod.id,
      });

      await expect(
        createFieldDefinition(tx, {
          tenantId: tenant.id,
          entityTypeId: entityType.id,
          name: "Bogus",
          slug: "bogus",
          fieldType: "not_a_type" as FieldType,
        })
      ).rejects.toThrow(/invalid field type/i);
    });
  });

  test("rejects duplicate slug within the same entity type", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");
      const entityType = await createTestEntityType(tx, {
        tenantId: tenant.id,
        moduleId: mod.id,
      });

      await createFieldDefinition(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        name: "Status",
        slug: "status",
        fieldType: "select",
      });

      await expect(
        createFieldDefinition(tx, {
          tenantId: tenant.id,
          entityTypeId: entityType.id,
          name: "Status (duplicate)",
          slug: "status",
          fieldType: "text",
        })
      ).rejects.toThrow(/already exists/i);
    });
  });
});

describe("field engine — updateFieldDefinition", () => {
  test("updates allowed fields on a custom field", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");
      const entityType = await createTestEntityType(tx, {
        tenantId: tenant.id,
        moduleId: mod.id,
      });
      const field = await createFieldDefinition(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        name: "Notes",
        slug: "notes",
        fieldType: "long_text",
      });

      const updated = await updateFieldDefinition(tx, {
        fieldId: field.id,
        tenantId: tenant.id,
        updates: {
          name: "Account Notes",
          labels: { fr: "Notes du compte" },
          displayOrder: 99,
        },
      });

      expect(updated.name).toBe("Account Notes");
      // Merged labels — en stays, fr added
      expect(updated.labels).toEqual({
        en: "Notes",
        fr: "Notes du compte",
      });
      expect(updated.displayOrder).toBe(99);
    });
  });

  test("refuses to change fieldType on a system field", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");
      const entityType = await createTestEntityType(tx, {
        tenantId: tenant.id,
        moduleId: mod.id,
      });
      const field = await createFieldDefinition(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        name: "Name",
        slug: "name",
        fieldType: "text",
        isSystem: true,
      });

      await expect(
        updateFieldDefinition(tx, {
          fieldId: field.id,
          tenantId: tenant.id,
          updates: { fieldType: "number" },
        })
      ).rejects.toThrow(/fieldType/i);
    });
  });

  test("allows renaming labels on a system field", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");
      const entityType = await createTestEntityType(tx, {
        tenantId: tenant.id,
        moduleId: mod.id,
      });
      const field = await createFieldDefinition(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        name: "Name",
        slug: "name",
        fieldType: "text",
        isSystem: true,
      });

      const updated = await updateFieldDefinition(tx, {
        fieldId: field.id,
        tenantId: tenant.id,
        updates: { labels: { en: "Company Name" } },
      });
      expect((updated.labels as Record<string, string>).en).toBe(
        "Company Name"
      );
    });
  });
});

describe("field engine — deleteFieldDefinition", () => {
  test("refuses to delete a system field even with force=true", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");
      const entityType = await createTestEntityType(tx, {
        tenantId: tenant.id,
        moduleId: mod.id,
      });
      const field = await createFieldDefinition(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
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

      // force=true still blocked
      await expect(
        deleteFieldDefinition(tx, {
          fieldId: field.id,
          tenantId: tenant.id,
          force: true,
        })
      ).rejects.toThrow(/system field/i);
    });
  });

  test("deletes a custom field with no populated record data", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");
      const entityType = await createTestEntityType(tx, {
        tenantId: tenant.id,
        moduleId: mod.id,
      });
      const field = await createFieldDefinition(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        name: "Notes",
        slug: "notes",
        fieldType: "long_text",
      });

      await deleteFieldDefinition(tx, {
        fieldId: field.id,
        tenantId: tenant.id,
      });

      const remaining = await tx
        .select()
        .from(fieldDefinitions)
        .where(eq(fieldDefinitions.id, field.id));
      expect(remaining).toHaveLength(0);
    });
  });

  test("refuses to delete a field that has populated record data", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, user } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");
      const entityType = await createTestEntityType(tx, {
        tenantId: tenant.id,
        moduleId: mod.id,
      });
      const field = await createFieldDefinition(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        name: "Notes",
        slug: "notes",
        fieldType: "long_text",
      });

      // Write a record that has the field's slug populated.
      await tx.insert(records).values({
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        data: { notes: "Some content" },
        createdBy: user.id,
      });

      const err = await deleteFieldDefinition(tx, {
        fieldId: field.id,
        tenantId: tenant.id,
      }).catch((e) => e);

      expect(err).toBeInstanceOf(FieldDefinitionError);
      expect(err.code).toBe("has_data");
      expect(err.details?.recordCount).toBe(1);
    });
  });

  test("force=true deletes a field even when records have data", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, user } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");
      const entityType = await createTestEntityType(tx, {
        tenantId: tenant.id,
        moduleId: mod.id,
      });
      const field = await createFieldDefinition(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        name: "Notes",
        slug: "notes",
        fieldType: "long_text",
      });
      await tx.insert(records).values({
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        data: { notes: "Some content" },
        createdBy: user.id,
      });

      await deleteFieldDefinition(tx, {
        fieldId: field.id,
        tenantId: tenant.id,
        force: true,
      });

      const remaining = await tx
        .select()
        .from(fieldDefinitions)
        .where(eq(fieldDefinitions.id, field.id));
      expect(remaining).toHaveLength(0);
    });
  });

  test("data-presence check is tenant-scoped", async () => {
    // Two tenants, both use a field with the same slug. Deleting the
    // field in tenant A should not be blocked by records in tenant B.
    await withTestTransaction(async (tx) => {
      const { tenant: tenantA, user: userA } = await setupTestContext(tx);
      const { tenant: tenantB, user: userB } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");

      const etA = await createTestEntityType(tx, {
        tenantId: tenantA.id,
        moduleId: mod.id,
      });
      const etB = await createTestEntityType(tx, {
        tenantId: tenantB.id,
        moduleId: mod.id,
      });

      // Same slug "notes" in both tenants
      const fieldA = await createFieldDefinition(tx, {
        tenantId: tenantA.id,
        entityTypeId: etA.id,
        name: "Notes",
        slug: "notes",
        fieldType: "long_text",
      });
      await createFieldDefinition(tx, {
        tenantId: tenantB.id,
        entityTypeId: etB.id,
        name: "Notes",
        slug: "notes",
        fieldType: "long_text",
      });

      // Only tenant B has a record with notes populated.
      await tx.insert(records).values({
        tenantId: tenantB.id,
        entityTypeId: etB.id,
        data: { notes: "B has data" },
        createdBy: userB.id,
      });
      // Tenant A has a record but no notes.
      await tx.insert(records).values({
        tenantId: tenantA.id,
        entityTypeId: etA.id,
        data: { other: "no notes here" },
        createdBy: userA.id,
      });

      // Deleting in A should succeed — B's data doesn't count.
      await deleteFieldDefinition(tx, {
        fieldId: fieldA.id,
        tenantId: tenantA.id,
      });

      const remainingA = await tx
        .select()
        .from(fieldDefinitions)
        .where(eq(fieldDefinitions.id, fieldA.id));
      expect(remainingA).toHaveLength(0);
    });
  });
});

describe("field engine — listFieldDefinitions", () => {
  test("returns fields ordered by displayOrder then name", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");
      const entityType = await createTestEntityType(tx, {
        tenantId: tenant.id,
        moduleId: mod.id,
      });

      await createFieldDefinition(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        name: "Z",
        slug: "z",
        fieldType: "text",
        displayOrder: 1,
      });
      await createFieldDefinition(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        name: "A",
        slug: "a",
        fieldType: "text",
        displayOrder: 3,
      });
      await createFieldDefinition(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        name: "M",
        slug: "m",
        fieldType: "text",
        displayOrder: 2,
      });

      const list = await listFieldDefinitions(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
      });

      expect(list.map((f) => f.slug)).toEqual(["z", "m", "a"]);
    });
  });

  test("scopes by tenant — does not leak across tenants", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant: tenantA } = await setupTestContext(tx);
      const { tenant: tenantB } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");

      const etA = await createTestEntityType(tx, {
        tenantId: tenantA.id,
        moduleId: mod.id,
      });
      const etB = await createTestEntityType(tx, {
        tenantId: tenantB.id,
        moduleId: mod.id,
      });

      await createFieldDefinition(tx, {
        tenantId: tenantA.id,
        entityTypeId: etA.id,
        name: "A field",
        slug: "a_field",
        fieldType: "text",
      });
      await createFieldDefinition(tx, {
        tenantId: tenantB.id,
        entityTypeId: etB.id,
        name: "B field",
        slug: "b_field",
        fieldType: "text",
      });

      const aList = await listFieldDefinitions(tx, {
        tenantId: tenantA.id,
        entityTypeId: etA.id,
      });
      expect(aList).toHaveLength(1);
      expect(aList[0].slug).toBe("a_field");
    });
  });
});

// ============================================================
// coerceFieldValue — pure function, no DB
// ============================================================
describe("coerceFieldValue", () => {
  describe("required + nullable handling", () => {
    test("null value on required field returns required error", () => {
      const r = coerceFieldValue(
        { fieldType: "text", isRequired: true },
        null
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("required");
    });

    test("undefined on required field returns required error", () => {
      const r = coerceFieldValue(
        { fieldType: "text", isRequired: true },
        undefined
      );
      expect(r.ok).toBe(false);
    });

    test("empty string on required field returns required error", () => {
      const r = coerceFieldValue(
        { fieldType: "text", isRequired: true },
        ""
      );
      expect(r.ok).toBe(false);
    });

    test("null on non-required field returns ok with value=null", () => {
      const r = coerceFieldValue(
        { fieldType: "text", isRequired: false },
        null
      );
      expect(r).toEqual({ ok: true, value: null });
    });
  });

  describe("text + long_text", () => {
    test.each(["text", "long_text"] as const)(
      "%s accepts a string",
      (t) => {
        const r = coerceFieldValue({ fieldType: t }, "hello");
        expect(r).toEqual({ ok: true, value: "hello" });
      }
    );

    test("text rejects a number", () => {
      const r = coerceFieldValue({ fieldType: "text" }, 42);
      expect(r.ok).toBe(false);
    });

    test("text enforces minLength from options", () => {
      const r = coerceFieldValue(
        { fieldType: "text", options: { minLength: 5 } },
        "hi"
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("min_length");
    });

    test("text enforces maxLength from options", () => {
      const r = coerceFieldValue(
        { fieldType: "text", options: { maxLength: 3 } },
        "hello"
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("max_length");
    });

    test("text enforces regex pattern from options", () => {
      const r = coerceFieldValue(
        { fieldType: "text", options: { pattern: "^[A-Z]+$" } },
        "lowercase"
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("pattern");
    });
  });

  describe("number", () => {
    test("accepts a numeric value", () => {
      expect(coerceFieldValue({ fieldType: "number" }, 42)).toEqual({
        ok: true,
        value: 42,
      });
    });

    test('coerces "42" → 42', () => {
      expect(coerceFieldValue({ fieldType: "number" }, "42")).toEqual({
        ok: true,
        value: 42,
      });
    });

    test('rejects "not a number"', () => {
      const r = coerceFieldValue({ fieldType: "number" }, "not a number");
      expect(r.ok).toBe(false);
    });

    test("enforces min", () => {
      const r = coerceFieldValue(
        { fieldType: "number", options: { min: 10 } },
        5
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("min_value");
    });

    test("enforces max", () => {
      const r = coerceFieldValue(
        { fieldType: "number", options: { max: 100 } },
        200
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("max_value");
    });

    test("enforces integer flag", () => {
      const r = coerceFieldValue(
        { fieldType: "number", options: { integer: true } },
        3.14
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("integer");
    });
  });

  describe("currency", () => {
    test("accepts { amount, currency }", () => {
      const r = coerceFieldValue(
        { fieldType: "currency" },
        { amount: 50000, currency: "GBP" }
      );
      expect(r).toEqual({
        ok: true,
        value: { amount: 50000, currency: "GBP" },
      });
    });

    test("rejects missing currency code", () => {
      const r = coerceFieldValue(
        { fieldType: "currency" },
        { amount: 100 }
      );
      expect(r.ok).toBe(false);
    });

    test("rejects lowercase currency code", () => {
      const r = coerceFieldValue(
        { fieldType: "currency" },
        { amount: 100, currency: "gbp" }
      );
      expect(r.ok).toBe(false);
    });

    test("enforces allowedCurrencies", () => {
      const r = coerceFieldValue(
        { fieldType: "currency", options: { allowedCurrencies: ["GBP"] } },
        { amount: 100, currency: "USD" }
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("currency_not_allowed");
    });
  });

  describe("date", () => {
    test("accepts YYYY-MM-DD", () => {
      const r = coerceFieldValue({ fieldType: "date" }, "2026-05-28");
      expect(r).toEqual({ ok: true, value: "2026-05-28" });
    });

    test("accepts a Date object", () => {
      const d = new Date("2026-05-28T12:00:00Z");
      const r = coerceFieldValue({ fieldType: "date" }, d);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe("2026-05-28");
    });

    test("rejects malformed string", () => {
      const r = coerceFieldValue({ fieldType: "date" }, "not a date");
      expect(r.ok).toBe(false);
    });
  });

  describe("datetime", () => {
    test("accepts ISO timestamp", () => {
      const r = coerceFieldValue(
        { fieldType: "datetime" },
        "2026-05-28T10:00:00Z"
      );
      expect(r.ok).toBe(true);
    });

    test("rejects unparseable string", () => {
      const r = coerceFieldValue({ fieldType: "datetime" }, "nope");
      expect(r.ok).toBe(false);
    });
  });

  describe("boolean", () => {
    test("accepts true / false", () => {
      expect(coerceFieldValue({ fieldType: "boolean" }, true)).toEqual({
        ok: true,
        value: true,
      });
      expect(coerceFieldValue({ fieldType: "boolean" }, false)).toEqual({
        ok: true,
        value: false,
      });
    });

    test('coerces "true" / "false" strings', () => {
      expect(coerceFieldValue({ fieldType: "boolean" }, "true")).toEqual({
        ok: true,
        value: true,
      });
      expect(coerceFieldValue({ fieldType: "boolean" }, "false")).toEqual({
        ok: true,
        value: false,
      });
    });

    test('rejects "maybe"', () => {
      const r = coerceFieldValue({ fieldType: "boolean" }, "maybe");
      expect(r.ok).toBe(false);
    });
  });

  describe("select / multi_select", () => {
    const choices = {
      choices: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
      ],
    };

    test("select accepts a valid choice", () => {
      expect(
        coerceFieldValue(
          { fieldType: "select", options: choices },
          "active"
        )
      ).toEqual({ ok: true, value: "active" });
    });

    test("select rejects a value not in choices", () => {
      const r = coerceFieldValue(
        { fieldType: "select", options: choices },
        "frozen"
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("not_in_choices");
    });

    test("multi_select accepts an array of valid choices", () => {
      const r = coerceFieldValue(
        { fieldType: "multi_select", options: choices },
        ["active", "inactive"]
      );
      expect(r.ok).toBe(true);
    });

    test("multi_select rejects an array containing an invalid value", () => {
      const r = coerceFieldValue(
        { fieldType: "multi_select", options: choices },
        ["active", "frozen"]
      );
      expect(r.ok).toBe(false);
    });
  });

  describe("email / phone / url / relationship", () => {
    test("email accepts foo@bar.com", () => {
      expect(coerceFieldValue({ fieldType: "email" }, "foo@bar.com")).toEqual(
        { ok: true, value: "foo@bar.com" }
      );
    });

    test("email rejects missing @", () => {
      expect(
        coerceFieldValue({ fieldType: "email" }, "not-an-email").ok
      ).toBe(false);
    });

    test("phone accepts any string", () => {
      const r = coerceFieldValue(
        { fieldType: "phone" },
        "  +44 20 7946 0958  "
      );
      expect(r).toEqual({ ok: true, value: "+44 20 7946 0958" });
    });

    test("phone rejects a non-string", () => {
      expect(coerceFieldValue({ fieldType: "phone" }, 12345).ok).toBe(false);
    });

    test("url accepts a valid URL", () => {
      const r = coerceFieldValue(
        { fieldType: "url" },
        "https://example.com"
      );
      expect(r.ok).toBe(true);
    });

    test("url rejects garbage", () => {
      expect(coerceFieldValue({ fieldType: "url" }, "not a url").ok).toBe(
        false
      );
    });

    test("relationship accepts a UUID", () => {
      const r = coerceFieldValue(
        { fieldType: "relationship" },
        "01234567-89ab-cdef-0123-456789abcdef"
      );
      expect(r.ok).toBe(true);
    });

    test("relationship rejects a non-UUID", () => {
      expect(
        coerceFieldValue({ fieldType: "relationship" }, "not-a-uuid").ok
      ).toBe(false);
    });
  });

  describe("Phase 2+ types — opaque pass-through", () => {
    test.each(["user", "file", "image", "json", "computed", "ai_generated"] as const)(
      "%s accepts any value (no validation in Phase 1)",
      (t) => {
        const r = coerceFieldValue({ fieldType: t }, { arbitrary: "data" });
        expect(r.ok).toBe(true);
      }
    );
  });
});
