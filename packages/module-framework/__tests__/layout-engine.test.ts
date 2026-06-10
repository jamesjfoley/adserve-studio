import { afterAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestEntityType,
  getModuleBySlug,
  setupTestContext,
  testClient,
  withTestTransaction,
} from "@adserve/database/test-helpers";
import { layouts } from "@adserve/database";
import { createFieldDefinition } from "../src/field-engine";
import {
  createLayout,
  deleteLayout,
  generateDefaultLayoutConfig,
  getDefaultLayout,
  LayoutError,
  updateLayoutConfig,
  validateLayoutConfig,
} from "../src/layout-engine";
import type { LayoutConfig } from "../src/types";

afterAll(async () => {
  await testClient.end();
});

/**
 * Helper: spin up a tenant + entity type + N fields in one shot.
 * Most layout tests need this exact setup.
 */
async function setupTenantWithFields(
  tx: Parameters<Parameters<typeof withTestTransaction>[0]>[0],
  specs: Array<{
    slug: string;
    name: string;
    displayOrder: number;
    groupName?: string | null;
  }>
) {
  const { tenant } = await setupTestContext(tx);
  const mod = await getModuleBySlug(tx, "crm");
  const entityType = await createTestEntityType(tx, {
    tenantId: tenant.id,
    moduleId: mod.id,
  });

  const fields = [];
  for (const spec of specs) {
    const field = await createFieldDefinition(tx, {
      tenantId: tenant.id,
      entityTypeId: entityType.id,
      name: spec.name,
      slug: spec.slug,
      fieldType: "text",
      displayOrder: spec.displayOrder,
      groupName: spec.groupName ?? null,
    });
    fields.push(field);
  }

  return { tenant, entityType, fields };
}

// ============================================================
// createLayout / retrieve
// ============================================================
describe("layout engine — createLayout", () => {
  test("creates a layout with valid config and retrieves it", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, entityType, fields } = await setupTenantWithFields(tx, [
        { slug: "name", name: "Name", displayOrder: 10 },
        { slug: "email", name: "Email", displayOrder: 20 },
      ]);

      const config: LayoutConfig = {
        sections: [
          {
            title: "Basic Info",
            columns: 2,
            fieldIds: [fields[0].id, fields[1].id],
          },
        ],
      };

      const layout = await createLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "detail",
        name: "Default Detail",
        isDefault: true,
        config,
      });

      expect(layout.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(layout.tenantId).toBe(tenant.id);
      expect(layout.entityTypeId).toBe(entityType.id);
      expect(layout.layoutType).toBe("detail");
      expect(layout.isDefault).toBe(true);
      expect(layout.config).toEqual(config);
    });
  });

  test("createLayout with invalid field IDs throws validation error before insert", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, entityType, fields } = await setupTenantWithFields(tx, [
        { slug: "name", name: "Name", displayOrder: 10 },
      ]);

      const config: LayoutConfig = {
        sections: [
          {
            title: "Bad",
            columns: 2,
            fieldIds: [fields[0].id, "00000000-0000-0000-0000-000000000000"],
          },
        ],
      };

      const err = await createLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "detail",
        name: "Bad Detail",
        config,
      }).catch((e) => e);

      expect(err).toBeInstanceOf(LayoutError);
      expect(err.code).toBe("invalid_config");
      expect(err.details?.errors[0].code).toBe("field_not_found");

      // Nothing should have been inserted.
      const all = await tx
        .select()
        .from(layouts)
        .where(eq(layouts.tenantId, tenant.id));
      expect(all).toHaveLength(0);
    });
  });

  test("createLayout with isDefault=true demotes any existing default for the same layoutType", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, entityType, fields } = await setupTenantWithFields(tx, [
        { slug: "name", name: "Name", displayOrder: 10 },
      ]);
      const config: LayoutConfig = {
        sections: [
          { title: "S", columns: 1, fieldIds: [fields[0].id] },
        ],
      };

      const first = await createLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "detail",
        name: "First",
        isDefault: true,
        config,
      });

      const second = await createLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "detail",
        name: "Second",
        isDefault: true,
        config,
      });

      const [firstAgain] = await tx
        .select()
        .from(layouts)
        .where(eq(layouts.id, first.id));
      expect(firstAgain.isDefault).toBe(false);
      expect(second.isDefault).toBe(true);
    });
  });

  test("createLayout demotion is scoped to the same layoutType", async () => {
    // A default on detail should not affect a default on list.
    await withTestTransaction(async (tx) => {
      const { tenant, entityType, fields } = await setupTenantWithFields(tx, [
        { slug: "name", name: "Name", displayOrder: 10 },
      ]);
      const config: LayoutConfig = {
        sections: [
          { title: "S", columns: 1, fieldIds: [fields[0].id] },
        ],
      };

      const detailDefault = await createLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "detail",
        name: "Detail default",
        isDefault: true,
        config,
      });

      await createLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "list",
        name: "List default",
        isDefault: true,
        config,
      });

      const [detailAgain] = await tx
        .select()
        .from(layouts)
        .where(eq(layouts.id, detailDefault.id));
      expect(detailAgain.isDefault).toBe(true);
    });
  });
});

// ============================================================
// updateLayoutConfig
// ============================================================
describe("layout engine — updateLayoutConfig", () => {
  test("updates a layout's config when all fieldIds are valid", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, entityType, fields } = await setupTenantWithFields(tx, [
        { slug: "name", name: "Name", displayOrder: 10 },
        { slug: "email", name: "Email", displayOrder: 20 },
      ]);

      const initial: LayoutConfig = {
        sections: [
          { title: "One", columns: 2, fieldIds: [fields[0].id] },
        ],
      };
      const layout = await createLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "detail",
        name: "L",
        config: initial,
      });

      const next: LayoutConfig = {
        sections: [
          { title: "One", columns: 1, fieldIds: [fields[0].id] },
          { title: "Two", columns: 2, fieldIds: [fields[1].id] },
        ],
      };
      const updated = await updateLayoutConfig(tx, {
        layoutId: layout.id,
        tenantId: tenant.id,
        config: next,
      });

      expect(updated.config).toEqual(next);
    });
  });

  test("update with nonexistent fieldId throws and leaves config unchanged", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, entityType, fields } = await setupTenantWithFields(tx, [
        { slug: "name", name: "Name", displayOrder: 10 },
      ]);
      const initial: LayoutConfig = {
        sections: [
          { title: "S", columns: 1, fieldIds: [fields[0].id] },
        ],
      };
      const layout = await createLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "detail",
        name: "L",
        config: initial,
      });

      const bad: LayoutConfig = {
        sections: [
          {
            title: "Bad",
            columns: 1,
            fieldIds: ["00000000-0000-0000-0000-000000000000"],
          },
        ],
      };

      await expect(
        updateLayoutConfig(tx, {
          layoutId: layout.id,
          tenantId: tenant.id,
          config: bad,
        })
      ).rejects.toThrow(/invalid/i);

      const [unchanged] = await tx
        .select()
        .from(layouts)
        .where(eq(layouts.id, layout.id));
      expect(unchanged.config).toEqual(initial);
    });
  });
});

// ============================================================
// deleteLayout
// ============================================================
describe("layout engine — deleteLayout", () => {
  test("refuses to delete the only layout for an entity type's layoutType", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, entityType, fields } = await setupTenantWithFields(tx, [
        { slug: "name", name: "Name", displayOrder: 10 },
      ]);
      const config: LayoutConfig = {
        sections: [
          { title: "S", columns: 1, fieldIds: [fields[0].id] },
        ],
      };
      const layout = await createLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "detail",
        name: "Only",
        config,
      });

      const err = await deleteLayout(tx, {
        layoutId: layout.id,
        tenantId: tenant.id,
      }).catch((e) => e);

      expect(err).toBeInstanceOf(LayoutError);
      expect(err.code).toBe("last_layout");

      const [still] = await tx
        .select()
        .from(layouts)
        .where(eq(layouts.id, layout.id));
      expect(still).toBeDefined();
    });
  });

  test("deletes one of two layouts cleanly", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, entityType, fields } = await setupTenantWithFields(tx, [
        { slug: "name", name: "Name", displayOrder: 10 },
      ]);
      const config: LayoutConfig = {
        sections: [
          { title: "S", columns: 1, fieldIds: [fields[0].id] },
        ],
      };
      const first = await createLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "detail",
        name: "First",
        config,
      });
      const second = await createLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "detail",
        name: "Second",
        config,
      });

      await deleteLayout(tx, { layoutId: first.id, tenantId: tenant.id });

      const remaining = await tx
        .select()
        .from(layouts)
        .where(eq(layouts.tenantId, tenant.id));
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(second.id);
    });
  });

  test("delete count is scoped to layoutType", async () => {
    // A single detail layout + a single list layout. Deleting the detail
    // one should still refuse (it's the only "detail"), even though
    // there's a "list" layout that doesn't count toward the detail
    // tally.
    await withTestTransaction(async (tx) => {
      const { tenant, entityType, fields } = await setupTenantWithFields(tx, [
        { slug: "name", name: "Name", displayOrder: 10 },
      ]);
      const config: LayoutConfig = {
        sections: [
          { title: "S", columns: 1, fieldIds: [fields[0].id] },
        ],
      };
      const detail = await createLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "detail",
        name: "D",
        config,
      });
      await createLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "list",
        name: "L",
        config,
      });

      await expect(
        deleteLayout(tx, { layoutId: detail.id, tenantId: tenant.id })
      ).rejects.toThrow(/last_layout|only/i);
    });
  });
});

// ============================================================
// getDefaultLayout
// ============================================================
describe("layout engine — getDefaultLayout", () => {
  test("returns the layout marked isDefault=true when one exists", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, entityType, fields } = await setupTenantWithFields(tx, [
        { slug: "name", name: "Name", displayOrder: 10 },
      ]);
      const config: LayoutConfig = {
        sections: [
          { title: "S", columns: 1, fieldIds: [fields[0].id] },
        ],
      };
      await createLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "detail",
        name: "Not default",
        config,
      });
      const expected = await createLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "detail",
        name: "Default",
        isDefault: true,
        config,
      });

      const found = await getDefaultLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "detail",
      });
      expect(found?.id).toBe(expected.id);
    });
  });

  test("falls back to a deterministically-chosen layout when no explicit default exists", async () => {
    // Note on the semantics: PG's `now()` returns the transaction start
    // time, so both inserts in the same tx share `createdAt`. The
    // fallback's ORDER BY `createdAt ASC, id ASC` is still deterministic
    // (UUID tiebreaker is deterministic per row, just not creation-
    // order), so we test: same answer on repeat calls + it's one of the
    // candidates. The "first-by-creation-time" intent applies once
    // layouts span multiple tenant-admin actions, each in its own tx.
    await withTestTransaction(async (tx) => {
      const { tenant, entityType, fields } = await setupTenantWithFields(tx, [
        { slug: "name", name: "Name", displayOrder: 10 },
      ]);
      const config: LayoutConfig = {
        sections: [
          { title: "S", columns: 1, fieldIds: [fields[0].id] },
        ],
      };
      const a = await createLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "detail",
        name: "A",
        config,
      });
      const b = await createLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "detail",
        name: "B",
        config,
      });

      const found1 = await getDefaultLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "detail",
      });
      const found2 = await getDefaultLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "detail",
      });

      expect(found1).not.toBeNull();
      // Deterministic.
      expect(found1?.id).toBe(found2?.id);
      // One of the candidates.
      expect([a.id, b.id]).toContain(found1!.id);
    });
  });

  test("returns null when no layouts exist at all", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, entityType } = await setupTenantWithFields(tx, []);

      const found = await getDefaultLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        layoutType: "detail",
      });
      expect(found).toBeNull();
    });
  });
});

// ============================================================
// generateDefaultLayoutConfig
// ============================================================
describe("layout engine — generateDefaultLayoutConfig", () => {
  test("produces sections grouped by groupName ordered by min displayOrder", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, entityType, fields } = await setupTenantWithFields(tx, [
        { slug: "amount", name: "Amount", displayOrder: 30, groupName: "Financials" },
        { slug: "name", name: "Name", displayOrder: 10 }, // no group → General
        { slug: "employees", name: "Employees", displayOrder: 40, groupName: "Financials" },
        { slug: "email", name: "Email", displayOrder: 20 },
      ]);

      const config = await generateDefaultLayoutConfig(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
      });

      expect(config.sections).toHaveLength(2);

      // "General" group has min displayOrder 10, "Financials" has 30.
      // So General comes first.
      expect(config.sections[0].title).toBe("General");
      expect(config.sections[1].title).toBe("Financials");

      // Within "General": name (10), email (20)
      const fieldById = new Map(fields.map((f) => [f.id, f]));
      expect(
        config.sections[0].fieldIds.map((id) => fieldById.get(id)?.slug)
      ).toEqual(["name", "email"]);
      // Within "Financials": amount (30), employees (40)
      expect(
        config.sections[1].fieldIds.map((id) => fieldById.get(id)?.slug)
      ).toEqual(["amount", "employees"]);
    });
  });

  test("returns empty sections when entity has no fields", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, entityType } = await setupTenantWithFields(tx, []);
      const config = await generateDefaultLayoutConfig(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
      });
      expect(config).toEqual({ sections: [] });
    });
  });

  test("uses 2 columns by default per section", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, entityType } = await setupTenantWithFields(tx, [
        { slug: "x", name: "X", displayOrder: 10 },
      ]);
      const config = await generateDefaultLayoutConfig(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
      });
      expect(config.sections[0].columns).toBe(2);
    });
  });

  test("fields with null/empty groupName go into General", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, entityType } = await setupTenantWithFields(tx, [
        { slug: "a", name: "A", displayOrder: 10, groupName: null },
        { slug: "b", name: "B", displayOrder: 20 }, // implicit null
      ]);
      const config = await generateDefaultLayoutConfig(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
      });
      expect(config.sections).toHaveLength(1);
      expect(config.sections[0].title).toBe("General");
      expect(config.sections[0].fieldIds).toHaveLength(2);
    });
  });
});

// ============================================================
// validateLayoutConfig
// ============================================================
describe("layout engine — validateLayoutConfig", () => {
  test("catches nonexistent field IDs", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, entityType, fields } = await setupTenantWithFields(tx, [
        { slug: "name", name: "Name", displayOrder: 10 },
      ]);

      const result = await validateLayoutConfig(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        config: {
          sections: [
            {
              title: "S",
              columns: 1,
              fieldIds: [
                fields[0].id,
                "00000000-0000-0000-0000-000000000001",
              ],
            },
          ],
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const codes = result.errors.map((e) => e.code);
        expect(codes).toContain("field_not_found");
      }
    });
  });

  test("catches duplicate field IDs across sections", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, entityType, fields } = await setupTenantWithFields(tx, [
        { slug: "name", name: "Name", displayOrder: 10 },
        { slug: "email", name: "Email", displayOrder: 20 },
      ]);

      const result = await validateLayoutConfig(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        config: {
          sections: [
            { title: "A", columns: 1, fieldIds: [fields[0].id] },
            // fields[0].id used again
            { title: "B", columns: 1, fieldIds: [fields[0].id, fields[1].id] },
          ],
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const codes = result.errors.map((e) => e.code);
        expect(codes).toContain("duplicate_field");
      }
    });
  });

  test("catches invalid column counts", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, entityType, fields } = await setupTenantWithFields(tx, [
        { slug: "name", name: "Name", displayOrder: 10 },
      ]);

      const result = await validateLayoutConfig(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        config: {
          sections: [
            {
              title: "S",
              columns: 5 as unknown as 1 | 2 | 3 | 4,
              fieldIds: [fields[0].id],
            },
          ],
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const codes = result.errors.map((e) => e.code);
        expect(codes).toContain("invalid_columns");
      }
    });
  });

  test("collects multiple errors rather than failing on the first", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, entityType, fields } = await setupTenantWithFields(tx, [
        { slug: "name", name: "Name", displayOrder: 10 },
      ]);

      const result = await validateLayoutConfig(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        config: {
          sections: [
            {
              title: "Mess",
              columns: 5 as unknown as 1 | 2 | 3 | 4,
              fieldIds: [
                fields[0].id,
                fields[0].id, // duplicate
                "00000000-0000-0000-0000-000000000000", // not found
              ],
            },
          ],
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const codes = result.errors.map((e) => e.code);
        expect(codes).toContain("invalid_columns");
        expect(codes).toContain("duplicate_field");
        expect(codes).toContain("field_not_found");
      }
    });
  });

  test("returns ok for a valid config", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, entityType, fields } = await setupTenantWithFields(tx, [
        { slug: "name", name: "Name", displayOrder: 10 },
      ]);

      const result = await validateLayoutConfig(tx, {
        tenantId: tenant.id,
        entityTypeId: entityType.id,
        config: {
          sections: [
            { title: "S", columns: 1, fieldIds: [fields[0].id] },
          ],
        },
      });

      expect(result).toEqual({ ok: true });
    });
  });
});
