import { auditLog } from "@adserve/database";
import type { db } from "@adserve/database";

/**
 * Audit-log writer for CRM mutations. Task 1.2 is the first writer of the
 * `audit_log` table.
 *
 * `changes` shape by action (keep this consistent across the codebase):
 *   - create  → { after }                         (the new record's data)
 *   - update  → { before, after }                 (full data before/after)
 *   - archive → { before: { isArchived: false },
 *                 after:  { isArchived: true } }
 *   - convert → emitted as MULTIPLE rows: one `create` row per entity the
 *               conversion produced (account/contact/opportunity) PLUS one
 *               `update` row for the lead's status change. There is no
 *               single "convert" audit row.
 *
 * Activities (the `activities` table) are themselves a form of audit and
 * deliberately do NOT produce audit_log rows.
 *
 * `action` is the verb (create/update/archive); `resourceType` is the CRM
 * entity slug (account/contact/lead/opportunity); `resourceId` is the
 * record id. Runs inside the caller's tenant transaction.
 */
export type AuditAction = "create" | "update" | "archive";

export interface WriteAuditLogArgs {
  tenantId: string;
  userId: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  changes?: Record<string, unknown> | null;
}

export async function writeAuditLog(
  tx: typeof db,
  args: WriteAuditLogArgs
): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: args.tenantId,
    userId: args.userId,
    action: args.action,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    changes: args.changes ?? null,
  });
}
