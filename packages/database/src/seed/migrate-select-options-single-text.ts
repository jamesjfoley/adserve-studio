import "dotenv/config";
import { db, migrationClient } from "../client";
import { sql } from "drizzle-orm";

/**
 * One-off migration to the single-text select-option model.
 *
 * For every select / multi_select field definition the option is now ONE text:
 * the stored value IS the display label. This script:
 *   1. migrates stored record data: each select value is remapped old→label
 *      (single values and multi_select arrays), so existing selections survive;
 *   2. rewrites each field's options.choices so value === label (+ defaults
 *      options.sortAlphabetical to false when absent);
 *   3. re-stamps entity_types.settings.pipelineStages so each stage's `slug`
 *      (the stored stage key) equals its `name` — keeping the kanban board,
 *      dashboard rollups and convert flow consistent with the new stage values.
 *
 * LOCAL DEV ONLY. Idempotent: re-running is a no-op (values already === labels).
 */

type Choice = { value: string; label: string };
type FieldRow = {
  id: string;
  entityTypeId: string;
  slug: string;
  fieldType: string;
  options: { choices?: Choice[]; sortAlphabetical?: boolean } | null;
};

async function run() {
  console.log("🔁 Migrating select options to the single-text model...\n");

  const fieldRows = (await db.execute(sql`
    SELECT id, entity_type_id AS "entityTypeId", slug,
           field_type AS "fieldType", options
    FROM field_definitions
    WHERE field_type IN ('select', 'multi_select')
  `)) as unknown as FieldRow[];

  // Per entity type → its select fields with an old-value → label map (built
  // from the CURRENT choices, before we overwrite them).
  const byEntity = new Map<
    string,
    { slug: string; fieldType: string; map: Map<string, string> }[]
  >();
  for (const f of fieldRows) {
    const map = new Map<string, string>();
    for (const c of f.options?.choices ?? []) map.set(c.value, c.label);
    const list = byEntity.get(f.entityTypeId) ?? [];
    list.push({ slug: f.slug, fieldType: f.fieldType, map });
    byEntity.set(f.entityTypeId, list);
  }

  // 1. Remap stored record data (per entity type → one fetch).
  let recordsUpdated = 0;
  for (const [entityTypeId, fields] of byEntity) {
    const recs = (await db.execute(sql`
      SELECT id, data FROM records WHERE entity_type_id = ${entityTypeId}
    `)) as unknown as { id: string; data: Record<string, unknown> | null }[];

    for (const r of recs) {
      const data = { ...(r.data ?? {}) };
      let changed = false;
      for (const fld of fields) {
        const cur = data[fld.slug];
        if (fld.fieldType === "multi_select" && Array.isArray(cur)) {
          const next = cur.map((v) =>
            typeof v === "string" && fld.map.has(v) ? fld.map.get(v)! : v
          );
          if (next.some((v, i) => v !== cur[i])) {
            data[fld.slug] = next;
            changed = true;
          }
        } else if (
          typeof cur === "string" &&
          fld.map.has(cur) &&
          fld.map.get(cur)! !== cur
        ) {
          data[fld.slug] = fld.map.get(cur)!;
          changed = true;
        }
      }
      if (changed) {
        await db.execute(sql`
          UPDATE records SET data = ${JSON.stringify(data)}::jsonb, updated_at = now()
          WHERE id = ${r.id}
        `);
        recordsUpdated++;
      }
    }
  }

  // 2. Rewrite choices so value === label (+ default sortAlphabetical false).
  let fieldsUpdated = 0;
  for (const f of fieldRows) {
    const opts: { choices?: Choice[]; sortAlphabetical?: boolean } = {
      ...(f.options ?? {}),
    };
    opts.choices = (f.options?.choices ?? []).map((c) => ({
      value: c.label,
      label: c.label,
    }));
    if (typeof opts.sortAlphabetical !== "boolean") opts.sortAlphabetical = false;
    await db.execute(sql`
      UPDATE field_definitions SET options = ${JSON.stringify(opts)}::jsonb, updated_at = now()
      WHERE id = ${f.id}
    `);
    fieldsUpdated++;
  }

  // 3. Re-stamp pipeline stage keys (slug := name) in entity_types.settings.
  const ets = (await db.execute(sql`
    SELECT id, settings FROM entity_types WHERE settings ? 'pipelineStages'
  `)) as unknown as {
    id: string;
    settings: { pipelineStages?: { slug: string; name: string }[] } | null;
  }[];
  let entityTypesUpdated = 0;
  for (const et of ets) {
    const stages = et.settings?.pipelineStages ?? [];
    if (stages.length === 0) continue;
    const settings = {
      ...(et.settings ?? {}),
      pipelineStages: stages.map((s) => ({ ...s, slug: s.name })),
    };
    await db.execute(sql`
      UPDATE entity_types SET settings = ${JSON.stringify(settings)}::jsonb, updated_at = now()
      WHERE id = ${et.id}
    `);
    entityTypesUpdated++;
  }

  console.log(`  ✓ Field definitions updated:     ${fieldsUpdated}`);
  console.log(`  ✓ Records remapped:              ${recordsUpdated}`);
  console.log(`  ✓ Entity-type pipelineStages:    ${entityTypesUpdated}\n`);
  console.log("✅ Migration complete.\n");
  await migrationClient.end();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("❌ Migration failed:", err);
  await migrationClient.end().catch(() => {});
  process.exit(1);
});
