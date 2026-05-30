/**
 * CRM permission matrix — 22 permissions seeded per tenant when the
 * CRM module is activated (Task 1.1 / 1.9a; `crm.admin` added in 1.8).
 *
 * Naming follows the existing Phase 2 convention: `resource.action`
 * stored as two columns, checked at runtime as
 * `ctx.permissions.has("account.read")` etc. Module scoping is via
 * the FK on `permissions.module_id` (set to the CRM module's id at
 * insert time).
 *
 * Action granularity matches the existing Phase 2 seed
 * (`read/create/update/delete`) plus capability-specific actions
 * (`lead.convert`, `pipeline.update`).
 *
 * The platform-level `ai_usage.read` permission lives in
 * `@adserve/ai-service` — see its `permissions.ts`.
 */

export interface CrmPermissionSpec {
  resource: string;
  action: string;
  description: string;
}

export const CRM_PERMISSIONS: CrmPermissionSpec[] = [
  // Accounts
  { resource: "account", action: "read", description: "View accounts" },
  { resource: "account", action: "create", description: "Create accounts" },
  { resource: "account", action: "update", description: "Edit accounts" },
  { resource: "account", action: "delete", description: "Archive accounts" },

  // Contacts
  { resource: "contact", action: "read", description: "View contacts" },
  { resource: "contact", action: "create", description: "Create contacts" },
  { resource: "contact", action: "update", description: "Edit contacts" },
  { resource: "contact", action: "delete", description: "Archive contacts" },

  // Leads (+ convert)
  { resource: "lead", action: "read", description: "View leads" },
  { resource: "lead", action: "create", description: "Create leads" },
  { resource: "lead", action: "update", description: "Edit leads" },
  { resource: "lead", action: "delete", description: "Archive leads" },
  {
    resource: "lead",
    action: "convert",
    description: "Convert a lead into account + contact + opportunity",
  },

  // Opportunities
  {
    resource: "opportunity",
    action: "read",
    description: "View opportunities",
  },
  {
    resource: "opportunity",
    action: "create",
    description: "Create opportunities",
  },
  {
    resource: "opportunity",
    action: "update",
    description: "Edit opportunities",
  },
  {
    resource: "opportunity",
    action: "delete",
    description: "Archive opportunities",
  },

  // Pipeline (read = kanban access; update = move opportunities between stages)
  {
    resource: "pipeline",
    action: "read",
    description: "View the pipeline kanban and aggregations",
  },
  {
    resource: "pipeline",
    action: "update",
    description: "Move opportunities between pipeline stages",
  },

  // Activities (no edit/delete on logged activities in Phase 1)
  { resource: "activity", action: "read", description: "View activities" },
  {
    resource: "activity",
    action: "create",
    description: "Log activities (calls, emails, meetings, tasks, notes)",
  },

  // CRM configuration (Task 1.8) — manage fields, layouts, pipeline stages.
  {
    resource: "crm",
    action: "admin",
    description: "Manage CRM configuration (fields, layouts, pipeline stages)",
  },
];

/**
 * Permission keys as the runtime-check form (`resource.action`).
 * Useful for `ctx.permissions.has(key)` callers and for role
 * assignment lists in `./role-assignments.ts`.
 */
export const CRM_PERMISSION_KEYS = CRM_PERMISSIONS.map(
  (p) => `${p.resource}.${p.action}`
);
