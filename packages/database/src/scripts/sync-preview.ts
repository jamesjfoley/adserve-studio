/**
 * sync-preview — on-demand data sync of CRM content between the LOCAL dev DB
 * and the HOSTED preview RDS (docs/preview-environment.md).
 *
 * Scope: the "My Organization" tenant's `records` + `record_relationships`
 * (plus any users those rows reference, so FKs hold in the target). It does NOT
 * touch tenants/roles/memberships (so the hosted-only demo login survives) and
 * does NOT sync schema (entity_types / schema_relationships) — if you add a new
 * entity type or field, do a one-off full `push` from the side that has it, or
 * re-seed.
 *
 * Modes:
 *   push  — local  -> hosted, FULL REPLACE within the tenant (adds + edits +
 *           hard-deletes propagate; overwrites hosted-only changes).
 *   pull  — hosted -> local,  FULL REPLACE within the tenant.
 *   sync  — bidirectional, ADDITIVE + newest-updated_at-wins. Archive-deletes
 *           (is_archived) propagate as ordinary field updates; HARD deletes do
 *           NOT; the older of two concurrent edits to the same row is lost.
 *
 * Safety: DRY-RUN by default — prints what would change. Pass --apply to write.
 *
 * Usage (via the wrapper, which injects HOSTED_DATABASE_URL from Secrets Mgr):
 *   scripts/sync-preview.sh <push|pull|sync> [--apply]
 * Or directly:
 *   HOSTED_DATABASE_URL=... pnpm --filter @adserve/database exec \
 *     tsx src/scripts/sync-preview.ts <push|pull|sync> [--apply]
 */
import postgres from "postgres";

const TENANT = "1e9a3688-b08f-4a9d-a187-f3b8e026933c"; // My Organization

const mode = process.argv[2] as "push" | "pull" | "sync" | undefined;
const apply = process.argv.includes("--apply");

if (!mode || !["push", "pull", "sync"].includes(mode)) {
  console.error("Usage: sync-preview <push|pull|sync> [--apply]");
  process.exit(1);
}

const LOCAL_URL =
  process.env.LOCAL_DATABASE_URL ?? "postgresql://jamesfoley@localhost:5432/adserve";
const HOSTED_URL = process.env.HOSTED_DATABASE_URL;
if (!HOSTED_URL) {
  console.error("HOSTED_DATABASE_URL is required (use scripts/sync-preview.sh).");
  process.exit(1);
}

type Sql = ReturnType<typeof postgres>;
const local = postgres(LOCAL_URL, { onnotice: () => {} });
const hosted = postgres(HOSTED_URL, {
  onnotice: () => {},
  ssl: /sslmode=require|rds\.amazonaws\.com/.test(HOSTED_URL) ? "require" : undefined,
});

const label = (s: Sql) => (s === local ? "local" : "hosted");

/** Insert any users referenced by the given records into dst (skip if present). */
async function ensureUsers(src: Sql, dst: Sql, records: any[]) {
  const ids = [
    ...new Set(
      records.flatMap((r) => [r.created_by, r.updated_by, r.owned_by]).filter(Boolean)
    ),
  ];
  if (ids.length === 0) return 0;
  const present = await dst<{ id: string }[]>`select id from users where id in ${dst(ids)}`;
  const presentSet = new Set(present.map((u) => u.id));
  const missing = ids.filter((id) => !presentSet.has(id));
  if (missing.length === 0) return 0;
  const users = await src<any[]>`select * from users where id in ${src(missing)}`;
  if (apply) {
    for (const u of users) {
      await dst`
        insert into users (id, email, full_name, avatar_url, auth_provider_id, status, created_at, updated_at, is_super_admin)
        values (${u.id}, ${u.email}, ${u.full_name}, ${u.avatar_url}, ${u.auth_provider_id}, ${u.status}, ${u.created_at}, ${u.updated_at}, ${u.is_super_admin})
        on conflict do nothing`;
    }
  }
  return users.length;
}

/** Guard: every entity_type / relationship a record set references must exist in dst. */
async function assertSchemaPresent(dst: Sql, records: any[], rels: any[]) {
  const etIds = [...new Set(records.map((r) => r.entity_type_id))];
  const relIds = [...new Set(rels.map((r) => r.relationship_id))];
  if (etIds.length) {
    const have = await dst<{ id: string }[]>`select id from entity_types where id in ${dst(etIds)}`;
    const missing = etIds.filter((id) => !have.find((h) => h.id === id));
    if (missing.length)
      throw new Error(
        `${missing.length} entity_type(s) missing in ${label(dst)} — schema diverged. ` +
          `Re-seed or full-refresh the target before syncing records.`
      );
  }
  if (relIds.length) {
    const have = await dst<{ id: string }[]>`select id from relationships where id in ${dst(relIds)}`;
    const missing = relIds.filter((id) => !have.find((h) => h.id === id));
    if (missing.length)
      throw new Error(
        `${missing.length} relationship type(s) missing in ${label(dst)} — schema diverged.`
      );
  }
}

async function upsertRecord(dst: Sql, r: any) {
  // newest-wins: only overwrite an existing row if the incoming one is newer.
  await dst`
    insert into records (id, tenant_id, entity_type_id, data, created_by, updated_by, owned_by, is_archived, created_at, updated_at)
    values (${r.id}, ${r.tenant_id}, ${r.entity_type_id}, ${dst.json(r.data)}, ${r.created_by}, ${r.updated_by}, ${r.owned_by}, ${r.is_archived}, ${r.created_at}, ${r.updated_at})
    on conflict (id) do update set
      entity_type_id = excluded.entity_type_id,
      data = excluded.data,
      updated_by = excluded.updated_by,
      owned_by = excluded.owned_by,
      is_archived = excluded.is_archived,
      updated_at = excluded.updated_at
    where records.updated_at <= excluded.updated_at`;
}

async function insertRelIfAbsent(dst: Sql, r: any) {
  await dst`
    insert into record_relationships (id, tenant_id, relationship_id, source_record_id, target_record_id, metadata, created_at)
    values (${r.id}, ${r.tenant_id}, ${r.relationship_id}, ${r.source_record_id}, ${r.target_record_id}, ${dst.json(r.metadata)}, ${r.created_at})
    on conflict (id) do nothing`;
}

/** One direction. replace=true does a full tenant-scoped replace; else additive merge. */
async function syncDirection(src: Sql, dst: Sql, replace: boolean) {
  const records = await src<any[]>`select * from records where tenant_id = ${TENANT}`;
  const rels = await src<any[]>`select * from record_relationships where tenant_id = ${TENANT}`;
  const dstRecords = await dst<{ id: string; updated_at: Date }[]>`select id, updated_at from records where tenant_id = ${TENANT}`;
  const dstRecIds = new Set(dstRecords.map((r) => r.id));
  const dstRelIds = new Set(
    (await dst<{ id: string }[]>`select id from record_relationships where tenant_id = ${TENANT}`).map((r) => r.id)
  );

  // counts for the report
  const recAdds = records.filter((r) => !dstRecIds.has(r.id)).length;
  const recUpdates = records.filter((r) => {
    const d = dstRecords.find((x) => x.id === r.id);
    return d && new Date(r.updated_at) > new Date(d.updated_at);
  }).length;
  const relAdds = rels.filter((r) => !dstRelIds.has(r.id)).length;
  const recDeletes = replace ? [...dstRecIds].filter((id) => !records.find((r) => r.id === id)).length : 0;

  console.log(
    `  ${label(src)} -> ${label(dst)}: ${recAdds} new record(s), ${recUpdates} updated, ` +
      `${relAdds} new link(s)` + (replace ? `, ${recDeletes} deleted` : ``)
  );

  const refUsers = await ensureUsers(src, dst, records);
  if (refUsers) console.log(`    (+${refUsers} referenced user row(s) ensured in ${label(dst)})`);
  await assertSchemaPresent(dst, records, rels);

  if (!apply) return;

  await dst.begin(async (tx) => {
    if (replace) {
      await tx`delete from record_relationships where tenant_id = ${TENANT}`;
      await tx`delete from records where tenant_id = ${TENANT}`;
    }
    for (const r of records) await upsertRecord(tx as unknown as Sql, r);
    for (const r of rels) await insertRelIfAbsent(tx as unknown as Sql, r);
  });
}

async function main() {
  console.log(
    `\n🔄 sync-preview [${mode}] ${apply ? "(APPLY)" : "(dry-run — pass --apply to write)"}\n`
  );
  if (mode === "push") await syncDirection(local, hosted, true);
  else if (mode === "pull") await syncDirection(hosted, local, true);
  else {
    // bidirectional additive merge
    await syncDirection(local, hosted, false);
    await syncDirection(hosted, local, false);
  }
  // final tallies
  const [lc] = await local`select count(*)::int as n from records where tenant_id = ${TENANT}`;
  const [hc] = await hosted`select count(*)::int as n from records where tenant_id = ${TENANT}`;
  console.log(`\n  records now — local: ${lc.n}, hosted: ${hc.n}`);
  console.log(apply ? "\n✅ done.\n" : "\n(dry-run; nothing written)\n");
}

main()
  .catch((e) => {
    console.error("❌ sync failed:", e.message ?? e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await local.end();
    await hosted.end();
  });
