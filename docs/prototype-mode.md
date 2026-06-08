# Prototype Mode — operating contract

A deliberate, temporary speed mode for building or extending a module fast as a working,
visually-polished prototype, while protecting production and producing a spec the multi-agent
pipeline rebuilds to production quality. The prototype CODE is disposable; the SPEC it produces is
the durable handoff. Adopt until told to "exit prototype mode."

## Four stages / platforms

| Stage | Branch | Platform | Database | Test bar | Workflow |
|---|---|---|---|---|---|
| 1 · Local prototype | `prototype/<module>` | Local `pnpm dev` | Local Homebrew Postgres | Tenant-isolation + authz smoke only (`adserve_app`) | Prototype Mode — Desktop↔CC, single-pass, no subagents |
| 2 · Prototype hosted (preview) | same `prototype/<module>`, pushed | Isolated AWS preview env (own service + URL) | Separate dummy-data DB — never prod RDS | same as Stage 1 | Deliberate "share" deploy; never main, never prod |
| 3 · Production rebuild (local) | `feat/<feature>` | Local `pnpm dev` / `pnpm test` | Local Postgres | Full — 100% coverage, full RLS harness, edge/error | Multi-agent — planner → architect-reviewer → builder → qa |
| 4 · Production hosted | `feat/<feature>` → `main` | Prod ECS (eu-west-2) | Prod RDS (gated migrations) | CI gates green | PR → human merge gate → ECS deploy |

Guardrail: Stages 1–2 never touch the production platform or prod data. Stages 3–4 are the only path to production.

## Stage 1 — local prototype (the loop)
- Branch `prototype/<module>` off main; checkpoint commits, no squash ceremony; local only during the build loop.
- Per slice: fast feasibility scan, raise ONLY blocking / feasibility / production-risk flags (batched, brief); if none, just build. Single pass — no subagents, no separate QA cycle. Runs under `pnpm dev`; end every report with "look at: <path / what to click>".
- Thin deliberately: skip comprehensive coverage, exhaustive edge cases, elaborate error states. Happy path + core interaction. Don't gold-plate.
- Design at the highest UI/UX bar: drive everything from `adserve-design` (tokens + the `Panel` primitive, light AND dark, per-org palette via `--accent`); `adserve-design` wins over `frontend-design` on conflict; never hardcode a colour that bypasses the palette / dark-mode tokens.
- Done-bar (non-negotiable): `pnpm dev` runs as the local superuser and BYPASSES RLS, so "looks right in the browser" is necessary but NOT sufficient. Anything tenant-scoped keeps a tenant-isolation + authz SMOKE test under the `adserve_app` (NOBYPASSRLS) harness via `pnpm test`.
- SPEC discipline: maintain `docs/prototypes/<module>/SPEC.md` (Goal · Current surface map · Planned extension · Data model touched · Auth & permissions · Tenant-isolation notes · Production Considerations log · Open questions). Log every shortcut, assumption, deferred concern, and anything that would be hard or impossible to do for real in production.

## Stage 2 — prototype hosted (preview)
- The SAME `prototype/<module>` branch deployed to an ISOLATED AWS preview environment: its own service, dummy-data database, secrets, and URL; colleague-only access; an in-app "PROTOTYPE" banner.
- Pushing the branch and deploying to preview is a deliberate "share with colleagues" action, separate from the build loop.
- NEVER merges to `main`; NEVER deploys to prod ECS / prod RDS.

## Stage 3 — production rebuild (local)
- The multi-agent pipeline (`.claude/agents`: planner → architect-reviewer → builder → qa, orchestrated by the lead/Desktop session) rebuilds from the SIGNED-OFF SPEC, on `feat/<feature>` off main. The prototype's `docs/prototypes/<module>/SPEC.md` is the planner's input — see docs/agent-workflow.md, "handoff contract — the spec is the spine".
- Full quality: 100% coverage, full RLS harness, edge/error states; built and demonstrable locally. `ARCHITECTURE.md` invariants apply. The multi-agent setup is preserved untouched during Prototype Mode and resumed here.

## Stage 4 — production hosted
- `feat/*` → PR → human merge gate → `main` → ~11-minute ECS deploy. CI gates green. Standing human gates on destructive DB / RLS / IAM / infra changes.

## Quarantine rule (amended 2026-06-08)
Originally: the prototype branch was local-only — never push or deploy. Amended: it MAY be pushed and deployed to the isolated preview environment (Stage 2) as a deliberate share action, but still NEVER merges to `main` and NEVER deploys to prod. Quarantine now means "never reaches the production platform," not "never leaves the laptop."
