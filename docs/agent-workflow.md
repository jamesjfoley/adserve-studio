# Agent Workflow — AdServe Studio

How development runs as a set of named Claude Code agents coordinated by one lead session.
This is the operating manual; `ARCHITECTURE.md` holds the invariants the agents protect.

> Mechanics caveat: the subagent frontmatter (`tools:` syntax, `Bash(...)` matchers) and hook
> event names reflect Claude Code as of early 2026. Verify the exact schema against the current
> docs (https://docs.claude.com/en/docs/claude-code/overview) before relying on edge details.

## Roster

| Agent | Talks to you? | Can write? | Can deploy/merge? | Owns |
|---|---|---|---|---|
| **lead** | yes | delegates | no | orchestration; the only agent you converse with |
| **`architect-reviewer`** | via lead | no (read-only) | **no — merge is a human gate** | the invariants + the PR gate: reviews plans against `ARCHITECTURE.md`, reviews diffs against the plan + invariants, opens the PR, confirms the four checks |
| **`planner`** | via lead | `docs/` only | no | the spec + acceptance criteria |
| **`builder`** | via lead | code, on a branch | no | implementation against an approved plan |
| **`qa`** | via lead | test files only | no | tests against acceptance criteria, under RLS harness |

`architect-reviewer` is deliberately **one** combined role (plan-review + diff-review + PR-open +
gate-check), not a separate `architect` and `reviewer`.

Pipeline is **not an agent** — it is your existing GitHub Actions CI plus hooks. An LLM
babysitting deploys is less reliable than deterministic checks; keep it deterministic.

## Interaction model — orchestrator/worker, not peer negotiation

The **lead** delegates to one specialist at a time, collects the result, and adjudicates.
Agents do **not** free-form converse with each other (that loops, drifts, and burns tokens).
Where a step needs clarification, it is a **single bounded bounce routed through the lead**:

- `architect-reviewer` may bounce a plan back to `planner` **once**.
- `builder` may ask `planner` **one** clarifying round (via the lead) before building.
- `architect-reviewer` may bounce a diff back to `builder` **once**.

If a bounce doesn't resolve it, the lead escalates to you rather than looping.

## The handoff contract — the spec is the spine

`planner` writes a plan to `docs/plans/<feature>.md` with **explicit, testable acceptance
criteria and test obligations**. That document is the contract:

- `architect-reviewer` signs off the plan against the invariants.
- `builder` builds **to the acceptance criteria** (not to its own interpretation).
- `qa` writes tests **from the acceptance criteria** — never reverse-engineered from the
  implementation (code-derived tests are tautological and prove nothing).
- `architect-reviewer` checks the diff **against the acceptance criteria and `ARCHITECTURE.md`**,
  then opens the PR and confirms the four required checks are green.

The agents are interchangeable around the spec; the spec is what carries quality.

When a feature began life as a prototype (see `docs/prototype-mode.md`), this pipeline is resumed
for the **production rebuild**: the prototype's `docs/prototypes/<module>/SPEC.md` is the planner's
input, from which `planner` writes the `docs/plans/<feature>.md` contract.

## Lifecycle

```
request → /plan (planner) → architect-reviewer: plan review ──┐
                                                              │ (bounce ×1 max)
                                                              ▼
    /build (builder) → /qa (qa) → /review (architect-reviewer: diff review → open PR → gate-check)
                                                                  │
                                          [ HUMAN GATE 1: merge to main ]
                                                                  │
                                          [ HUMAN GATE 2: deploy to prod ]
```

Everything up to and including **opening the PR** is autonomous. Merging and deploying are
each an explicit human go-ahead.

## Gate policy

**Autonomous (no prompt):** planning, `architect-reviewer` plan-review, building on a feature
branch, running lint/build/the RLS test harness locally, writing tests, the `architect-reviewer`
diff-review, opening the PR, and confirming the four CI checks.

**Human gate (explicit go-ahead required):**
1. **Merge PR → `main`.**
2. **Deploy → prod.**

**Standing human gates (anywhere in the flow, no exceptions):** anything in `ARCHITECTURE.md §6`
— prod deploys, destructive/irreversible DB ops, RLS/policy changes, IAM/secrets/permission
changes, infra changes. `builder` treats the **protected paths** below as off-limits without an
explicit go-ahead relayed through the lead, and `architect-reviewer` flags any plan/diff that
touches them as requiring a human gate:

- `packages/database/sql/**` (RLS policies/migrations)
- Drizzle schema for RLS-protected tables
- `.github/workflows/**` (the CI and deploy gates themselves)
- any infra / secrets configuration

## Build sequence

- **Phase 0 — invariants substrate.** `ARCHITECTURE.md` + the CLAUDE.md additions below. ✅ drafted
- **Phase 1 — agent definitions.** The four `.claude/agents/*.md` files (`planner`, `builder`,
  `qa`, and the combined `architect-reviewer`). ✅ drafted
- **Phase 2 — deterministic gates (hooks).** Hooks to run lint/tests on `builder` edits and to
  block edits to protected paths without an override. Keep the four CI checks as the merge gate.
- **Phase 3 — workflow commands.** Slash commands `/plan`, `/build`, `/qa`, `/review` encoding
  the lifecycle and the bounded bounces.
- **Phase 4 — autonomy policy codified.** The gate policy above written into CLAUDE.md so every
  agent inherits it.
- **Phase 5 — pilot.** Run the whole loop on one small CRM embellishment (one field type or one
  view), measure where it breaks, tune, then trust it. Do not roll the full machine out before
  proving it on a single feature.

Phases 2–5 are the next approvals; this drop is 0–1.

---

## Append to CLAUDE.md

```md
## Agent workflow (see docs/agent-workflow.md)
- Development runs through named agents: planner → architect-reviewer (plan review) → builder →
  qa → architect-reviewer (diff review + open PR + gate-check), orchestrated by the lead session.
  Agents do not converse peer-to-peer; the lead delegates. architect-reviewer is ONE combined
  role, not a separate architect and reviewer.
- The plan at docs/plans/<feature>.md with explicit acceptance criteria is the contract.
  Build to it, test from it, review against it.
- ARCHITECTURE.md holds the invariants. A change that violates one is a blocking defect.
- Autonomous up to opening the PR. Merging to main and deploying to prod are each a human gate;
  architect-reviewer opens PRs but NEVER merges or deploys.
- Standing human gates (any time): prod deploys, destructive/irreversible DB ops, RLS/policy
  changes, IAM/secrets/permission changes, infra changes.
- Protected paths builder must not edit without an explicit human go-ahead:
  packages/database/sql/**, RLS-table Drizzle schema, .github/workflows/**, infra/secrets config.
- Tests run under the RLS-enforced adserve_app harness, never a superuser DB.
```
