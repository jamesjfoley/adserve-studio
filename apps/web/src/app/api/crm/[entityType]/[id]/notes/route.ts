import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { records, withTenant } from "@adserve/database";
import { resolveCrmEntitySlug } from "@adserve/crm";
import { getEntityTypeBySlug } from "@adserve/module-framework";
import {
  apiRequirePermission,
  getTenantContextOrNull,
  type TenantContext,
} from "@/lib/permissions";
import { writeAuditLog } from "@/lib/crm/audit";
import {
  readNoteItems,
  sortNotesNewestFirst,
  NOTE_TYPES,
  MAX_ATTACHMENT_DATAURL_CHARS,
  type NoteItem,
  type NoteType,
} from "@/lib/crm/notes";

type Params = { params: Promise<{ entityType: string; id: string }> };

function canMutate(ctx: TenantContext, key: string, ownedBy: string | null) {
  if (ctx.permissions.has(key)) return true;
  return ownedBy !== null && ownedBy === ctx.user.id;
}

function isHttpUrl(v: unknown): v is string {
  return typeof v === "string" && /^https?:\/\//i.test(v.trim());
}

/**
 * Notes & Attachments for a CRM record (Account / Contact). Stored on the
 * record's `records.data.notesAttachments` array — no new table/RLS (the items
 * inherit the record's tenant isolation). GET needs `${slug}.read`; mutations
 * need `${slug}.update` (or record ownership).
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { entityType: segment, id } = await params;
  const slug = resolveCrmEntitySlug(segment);
  if (!slug) return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });

  const guard = await apiRequirePermission(`${slug}.read`);
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;

  const items = await withTenant(tenant.id, async (tx) => {
    const entity = await getEntityTypeBySlug(tx, { tenantId: tenant.id, slug });
    if (!entity) return null;
    const [rec] = await tx
      .select({ data: records.data })
      .from(records)
      .where(
        and(
          eq(records.id, id),
          eq(records.tenantId, tenant.id),
          eq(records.entityTypeId, entity.id)
        )
      );
    if (!rec) return null;
    return sortNotesNewestFirst(readNoteItems(rec.data));
  });

  if (items === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ items });
}

/**
 * Shared mutation path: resolve + authorize, load the record, hand its current
 * notes to `mutate`, persist the returned array, and return it sorted.
 */
async function mutateNotes(
  params: Params["params"],
  mutate: (
    current: NoteItem[],
    ctx: TenantContext
  ) => { items: NoteItem[] } | { error: string; status: number }
): Promise<NextResponse> {
  const { entityType: segment, id } = await params;
  const slug = resolveCrmEntitySlug(segment);
  if (!slug) return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });

  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const ctx = await getTenantContextOrNull();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenant } = ctx;

  const outcome = await withTenant(tenant.id, async (tx) => {
    const entity = await getEntityTypeBySlug(tx, { tenantId: tenant.id, slug });
    if (!entity) return { kind: "not_found" as const };
    const [rec] = await tx
      .select()
      .from(records)
      .where(
        and(
          eq(records.id, id),
          eq(records.tenantId, tenant.id),
          eq(records.entityTypeId, entity.id)
        )
      );
    if (!rec) return { kind: "not_found" as const };
    if (!canMutate(ctx, `${slug}.update`, rec.ownedBy ?? null)) {
      return { kind: "forbidden" as const };
    }

    const result = mutate(readNoteItems(rec.data), ctx);
    if ("error" in result) return { kind: "invalid" as const, ...result };

    await tx
      .update(records)
      .set({
        data: { ...(rec.data as object), notesAttachments: result.items },
        updatedBy: ctx.user.id,
        updatedAt: new Date(),
      })
      .where(and(eq(records.id, id), eq(records.tenantId, tenant.id)));

    await writeAuditLog(tx, {
      tenantId: tenant.id,
      userId: ctx.user.id,
      action: "update",
      resourceType: slug,
      resourceId: id,
      changes: { notesAttachments: result.items.length },
    });

    return { kind: "ok" as const, items: sortNotesNewestFirst(result.items) };
  });

  switch (outcome.kind) {
    case "not_found":
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    case "forbidden":
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    case "invalid":
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    case "ok":
      return NextResponse.json({ items: outcome.items });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  return mutateNotes(params, (current, ctx) => {
    const type = body.type as NoteType;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!NOTE_TYPES.includes(type)) return { error: "Invalid type", status: 400 };
    if (name === "") return { error: "Name is required", status: 422 };

    const item: NoteItem = {
      id: crypto.randomUUID(),
      type,
      name,
      addedById: ctx.user.id,
      addedByName: ctx.user.fullName ?? ctx.user.email ?? "Unknown",
      createdAt: new Date().toISOString(),
    };
    if (type === "note") {
      if (typeof body.body === "string") item.body = body.body;
    } else if (type === "link") {
      if (!isHttpUrl(body.url)) return { error: "A valid http(s) URL is required", status: 422 };
      item.url = (body.url as string).trim();
    } else {
      // attachment — a capped data URL
      if (typeof body.url !== "string" || !body.url.startsWith("data:")) {
        return { error: "Attachment must be a data URL", status: 422 };
      }
      if (body.url.length > MAX_ATTACHMENT_DATAURL_CHARS) {
        return { error: "Attachment is too large", status: 413 };
      }
      item.url = body.url;
      if (typeof body.fileName === "string") item.fileName = body.fileName;
      if (typeof body.fileSize === "number") item.fileSize = body.fileSize;
    }
    return { items: [...current, item] };
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  return mutateNotes(params, (current) => {
    const id = typeof body.id === "string" ? body.id : "";
    const idx = current.findIndex((n) => n.id === id);
    if (idx === -1) return { error: "Note not found", status: 404 };
    const next = current.slice();
    const item = { ...next[idx] };
    if (typeof body.name === "string") {
      if (body.name.trim() === "") return { error: "Name is required", status: 422 };
      item.name = body.name.trim();
    }
    if (typeof body.body === "string") item.body = body.body;
    if (typeof body.url === "string") {
      if (item.type === "link" && !isHttpUrl(body.url)) {
        return { error: "A valid http(s) URL is required", status: 422 };
      }
      item.url = body.url.trim();
    }
    item.updatedAt = new Date().toISOString();
    next[idx] = item;
    return { items: next };
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const fromQuery = new URL(req.url).searchParams.get("id");
  let id = fromQuery ?? "";
  if (!id) {
    try {
      const body = (await req.json()) as { id?: string };
      id = body?.id ?? "";
    } catch {
      // no body
    }
  }
  return mutateNotes(params, (current) => {
    if (!id || !current.some((n) => n.id === id)) {
      return { error: "Note not found", status: 404 };
    }
    return { items: current.filter((n) => n.id !== id) };
  });
}
