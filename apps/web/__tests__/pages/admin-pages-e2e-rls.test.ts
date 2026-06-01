import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { testDb } from "@adserve/database/test-helpers";
import { aiUsageLog } from "@adserve/database";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";
import {
  loadAdminAiUsageData,
  loadAdminDashboardData,
  loadAdminFieldsData,
  loadAdminLayoutsData,
  loadAdminNewRoleData,
  loadAdminPipelineConfigData,
  loadAdminRoleEditData,
  loadAdminRolesData,
  loadAdminSettingsData,
  loadAdminUsersData,
} from "@/lib/admin/loaders";

/**
 * End-to-end RLS coverage for the /admin/** page data paths. Each loader owns
 * the page's own withTenant() wrapper, so the positive assertions (A's rows
 * present) prove the page establishes tenant context — a forgotten wrapper
 * would make RLS return empty and fail them. Run as adserve_app (NOBYPASSRLS).
 * setupCrmTenant seeds, per tenant: 2 roles (owner+member), 2 users/memberships,
 * CRM activated (entity types, fields, layouts, pipeline stages, module enabled).
 */
let tenantA: CrmTestSetup;
let tenantB: CrmTestSetup;

beforeEach(async () => {
  tenantA = await setupCrmTenant();
  tenantB = await setupCrmTenant();
});
afterEach(async () => {
  if (tenantA?.tenantId) await teardownCrmTenant(tenantA.tenantId);
  if (tenantB?.tenantId) await teardownCrmTenant(tenantB.tenantId);
});

test("/admin counts: A's memberships counted, B's excluded", async () => {
  const c = await loadAdminDashboardData(tenantA.tenantId);
  expect(c.total).toBe(2); // positive (context) + isolation (not 4)
  expect(c.modules).toBeGreaterThan(0); // CRM enabled
});

test("/admin/roles: only tenant A's roles", async () => {
  const { tenantRoles } = await loadAdminRolesData(tenantA.tenantId);
  expect(tenantRoles.length).toBe(2);
  expect(tenantRoles.every((r) => r.tenantId === tenantA.tenantId)).toBe(true);
});

test("/admin/users: memberships are A's users only", async () => {
  const [memberships] = await loadAdminUsersData({ tenantId: tenantA.tenantId });
  const userIds = memberships.map((m) => m.userId);
  expect(userIds).toContain(tenantA.owner.id); // positive
  expect(userIds).not.toContain(tenantB.owner.id); // isolation
});

test("/admin/settings: A's enabled modules present (CRM)", async () => {
  const mods = await loadAdminSettingsData(tenantA.tenantId);
  expect(mods.length).toBeGreaterThan(0);
  expect(mods.some((m) => m.slug === "crm")).toBe(true);
});

test("/admin/ai-usage: A's usage rows present, B's absent", async () => {
  await testDb.insert(aiUsageLog).values({
    tenantId: tenantA.tenantId,
    module: "crm",
    capability: "activity_summary",
    model: "claude-haiku-4-5-20251001",
    status: "success",
    totalTokens: 100,
    costMicros: 1000,
  });
  await testDb.insert(aiUsageLog).values({
    tenantId: tenantB.tenantId,
    module: "crm",
    capability: "activity_summary",
    model: "claude-haiku-4-5-20251001",
    status: "success",
    totalTokens: 999,
    costMicros: 9999,
  });

  const { recent } = await loadAdminAiUsageData(tenantA.tenantId);
  expect(recent.length).toBeGreaterThan(0); // positive
  expect(recent.every((r) => r.tenantId === tenantA.tenantId)).toBe(true); // isolation
});

test("/admin/crm/fields: A's account fields present", async () => {
  const fields = await loadAdminFieldsData({
    tenantId: tenantA.tenantId,
    entitySlug: "account",
  });
  expect(fields.length).toBeGreaterThan(0);
  expect(fields.every((f) => f.tenantId === tenantA.tenantId)).toBe(true);
});

test("/admin/crm/layouts: A's account default layout resolves", async () => {
  const data = await loadAdminLayoutsData({
    tenantId: tenantA.tenantId,
    entitySlug: "account",
  });
  expect(data).not.toBeNull();
  expect(data!.layoutId).toBeTruthy();
  expect(Array.isArray(data!.fields)).toBe(true);
});

test("/admin/crm/pipeline: A's opportunity stages present", async () => {
  const stages = await loadAdminPipelineConfigData(tenantA.tenantId);
  expect(stages.length).toBeGreaterThan(0);
});

test("/admin/roles/new: visible permissions include CRM (tenantModules read worked)", async () => {
  const perms = await loadAdminNewRoleData(tenantA.tenantId);
  expect(perms.length).toBeGreaterThan(0); // positive: context set
  // CRM module enabled → module-scoped CRM perms visible (else only platform).
  expect(perms.some((p) => p.resource === "account")).toBe(true);
});

describe("/admin/roles/[id] isolation by id", () => {
  test("A loads its own role; A requesting B's role id → null", async () => {
    const own = await loadAdminRoleEditData({
      tenantId: tenantA.tenantId,
      roleId: tenantA.owner.roleId,
    });
    expect(own).not.toBeNull();
    expect(own!.role.id).toBe(tenantA.owner.roleId);

    const cross = await loadAdminRoleEditData({
      tenantId: tenantA.tenantId,
      roleId: tenantB.owner.roleId, // B's role id under A's context
    });
    expect(cross).toBeNull(); // isolation
  });
});
