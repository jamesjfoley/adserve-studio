import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * WS4 acceptance criteria #16 and #21 — Panel adoption (QA-derivable).
 *
 * Criterion #16 (LOCKED): the `Panel` primitive "is used by at least the CRM
 * detail, list, and dashboard sections." Criterion #21: each of those three
 * source files renders via `<Panel>` and no longer carries the inline
 * `rounded-xl border border-[var(--border)] p-6` section literal it replaced.
 *
 * This is a static source-scan so #16 is proven by an automated assertion, not
 * just visual inspection. It complements the behavioural regression guards in
 * crm-list-client.test.tsx and crm-detail-client.test.tsx (which render the
 * Panel-wrapped DOM) and the Panel unit tests in panel.test.tsx.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../../src/app/(platform)/crm");

const SECTIONS: Array<{ label: string; file: string }> = [
  {
    label: "dashboard (crm/page.tsx)",
    file: path.join(SRC, "page.tsx"),
  },
  {
    label: "list (crm-list-client.tsx)",
    file: path.join(SRC, "[entityType]/_components/crm-list-client.tsx"),
  },
  {
    label: "detail (related-records-panel.tsx)",
    file: path.join(
      SRC,
      "[entityType]/[id]/_components/related-records-panel.tsx"
    ),
  },
];

// The single import the boundary-safe Panel ships under.
const PANEL_IMPORT = /import\s*\{[^}]*\bPanel\b[^}]*\}\s*from\s*["']@\/components\/ui\/panel["']/;
// JSX use of the primitive: <Panel …> or <Panel> or <Panel\n.
const PANEL_JSX = /<Panel(\s|>|\/)/;
// The inline section literal WS4 replaced (criterion #21 — must be gone).
const LEGACY_PANEL_LITERAL = "rounded-xl border border-[var(--border)] p-6";

describe("WS4 #16/#21 — Panel adoption across CRM detail, list, and dashboard", () => {
  for (const section of SECTIONS) {
    describe(section.label, () => {
      const source = readFileSync(section.file, "utf8");

      test("imports Panel from the shared ui/panel module", () => {
        expect(source).toMatch(PANEL_IMPORT);
      });

      test("renders at least one <Panel> in its JSX", () => {
        expect(source).toMatch(PANEL_JSX);
      });

      test("no longer contains the inline rounded-xl section literal it replaced", () => {
        expect(source).not.toContain(LEGACY_PANEL_LITERAL);
      });
    });
  }

  test("all three required sections are covered", () => {
    const labels = SECTIONS.map((s) => s.label).join(", ");
    expect(SECTIONS).toHaveLength(3);
    expect(labels).toMatch(/dashboard/);
    expect(labels).toMatch(/list/);
    expect(labels).toMatch(/detail/);
  });
});
