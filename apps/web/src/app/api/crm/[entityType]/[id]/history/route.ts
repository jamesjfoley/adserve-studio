import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { auditLog, users, withTenant } from "@adserve/database";
import { resolveCrmEntitySlug } from "@adserve/crm";
import { apiRequirePermission } from "@/lib/permissions";

type Params = { params: Promise<{ entityType: string; id: string }> };

/** Cap returned audit rows — the panel shows recent history, newest first. */
const HISTORY_LIMIT = 100;

export interface HistoryEntry {
  id: string;
  action: string;
  changes: unknown;
  userId: string | null;
  /** Display name resolved from the users table, or null. */
  userName: string | null;
  createdAt: string;
}

/**
 * GET /api/crm/[entityType]/[id]/history — the per-record audit trail.
 *
 * Reads `audit_log` rows for this record under the caller's tenant (RLS),
 * newest first, capped at HISTORY_LIMIT. `changes` is returned verbatim; the
 * client derives field-level rows from its shape ({ before, after } etc).
 * userId → fullName is resolved cheaply via a left join on the users table.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { entityType: segment, id } = await params;
  const slug = resolveCrmEntitySlug(segment);
  if (!slug) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }

  const guard = await apiRequirePermission(`${slug}.read`);
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;

  const rows = await withTenant(tenant.id, async (tx) => {
    return tx
      .select({
        id: auditLog.id,
        action: auditLog.action,
        changes: auditLog.changes,
        userId: auditLog.userId,
        userName: users.fullName,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(
        and(eq(auditLog.tenantId, tenant.id), eq(auditLog.resourceId, id))
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(HISTORY_LIMIT);
  });

  const entries: HistoryEntry[] = rows.map((r) => ({
    id: r.id,
    action: r.action,
    changes: r.changes,
    userId: r.userId,
    userName: r.userName ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

  return NextResponse.json({ entries });
}
