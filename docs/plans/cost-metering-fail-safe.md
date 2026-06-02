# Plan — Cost metering fail-safe for unmapped models

**Feature slug:** `cost-metering-fail-safe`
**Author:** planner subagent
**Status:** plan (no code written — this doc is the contract)
**Date:** 2026-06-01

---

## 1. Goal / problem statement

`packages/ai-service/src/cost.ts` → `calculateCostMicros(model, usage)` currently does:

```ts
const pricing = MODEL_PRICING[model];
if (!pricing) return 0;
```

An **unmapped model id therefore bills at zero micros**. Because the metering
write path (`recordUsage`) and the cap check (`checkLimits`) both consume
`costMicros`, a model that is not in `MODEL_PRICING`:

- records `ai_usage_log` rows with `costMicros = 0`,
- never moves `ai_usage_summary.totalCostMicros`,
- and so **never counts toward the $50 / `DEFAULT_MONTHLY_COST_LIMIT_MICROS`
  cap** — the tenant can run unbounded spend on that model and the cap silently
  fails open.

This is reachable in practice: `models.ts` resolves capability → model and any
of the `AI_MODEL_*` env overrides (`resolveModelForCapability`) can point a
capability at a model id that nobody added to `MODEL_PRICING`. The risk is
called out as a known footgun in the code comments themselves
(`cost.ts:24-27`, `cost.ts:42-47`, `models.ts:18-19`).

### Invariant being realigned to

The brief cites this as **ARCHITECTURE.md §4**:

> "AI usage is metered in micros … Unmapped models must **fail safe**
> (surface/raise), never silently bill zero."

**Doc discrepancy (must be noted, not assumed away):** there is **no
`ARCHITECTURE.md` and no `docs/agent-workflow.md` in this repo.** The same
invariant is presently expressed only in source comments and in `CLAUDE.md`
("AI usage is metered in micros", "$50 cap … the £50 cap can't be enforced"
if cost is 0). The current `cost.ts` doc comment *contradicts* the fail-safe
rule — it explicitly says "Unknown model → returns 0 … Throwing here would
lose visibility into the call entirely." This plan changes the behaviour to
fail safe **and** updates that comment so code and invariant agree. If an
`ARCHITECTURE.md §4` is later authored, this change is what it should describe.

---

## 2. Resolved design decision

Two questions had to be resolved against the real call path
(`client.ts:272-410`). `calculateCostMicros` is a **pure sync function called
at `client.ts:387`, inside the `try` block that wraps the Anthropic call**
(lines 368-409). A throw from it is already caught by the existing
`catch (err)` at line 400, run through `mapError`, and returned as a clean
`{ ok: false, error }`. So a throw **cannot escape the service boundary** —
that catch is the safety net.

### HOW it fails — chosen: `calculateCostMicros` throws a typed error; `aiComplete` catches it explicitly on the success path

**Decision:** `calculateCostMicros` **throws** a new `UnmappedModelError`
(subclass of `Error`, defined in `cost.ts`, exported) when
`MODEL_PRICING[model]` is absent, instead of `return 0`.

In `aiComplete`, the cost calculation on the **success path** (currently a bare
`const costMicros = calculateCostMicros(model, tokenUsage)` at line 387) is
handled so that an unmapped model:

1. is mapped to a structured `AIError` (see WHERE below), and
2. **still emits a usage row that preserves the real token counts** with
   `status: "error"` (not `ZERO_USAGE`), so the attempt stays visible in
   `ai_usage_log` and ops can see what was spent-but-unpriced.

Concretely: wrap the cost computation so the unmapped case is detected and
turned into the `{ ok: false, error }` return *with the real `tokenUsage`*,
rather than letting it land in the generic line-400 catch (which would record
`ZERO_USAGE` and lose the token counts — acceptable for fail-safe, but worse
for observability). The line-400 catch remains as the backstop guaranteeing
"never throws past the boundary."

**Rationale:** keeping the raise in the pure function makes the invariant
testable in isolation (`cost.test.ts`) and impossible to bypass from any future
caller, while the chokepoint owns the clean surface + token-preserving usage
row. **Rejected alternatives:**
- *Return a `Result`/typed-error union from `calculateCostMicros`* — would
  ripple a new return type through every caller and the locked price-table test
  signature; heavier than the problem.
- *Detect the unmapped model only in `aiComplete` (leave the pure fn returning
  0)* — leaves the silent-zero footgun live for any other caller of
  `calculateCostMicros` and keeps the function's contract unsafe.

### WHERE / how it surfaces — chosen: new `unmapped_model` `AIError` code → HTTP 502

**Decision:** add a new `AIError` member and `AIErrorCode`:

```ts
{ code: "unmapped_model"; model: string; message: string }
```

- Set in `aiComplete` when `UnmappedModelError` is caught.
- `message` is clear and actionable, e.g.
  `"No pricing configured for model 'claude-foo-9'; refusing to bill at zero."`
- The `mapError` helper also gains an `instanceof UnmappedModelError` branch so
  the line-400 backstop maps it to the same `unmapped_model` code (defence in
  depth — both the explicit success-path handling and the generic catch produce
  the identical structured error).
- HTTP mapping in `apps/web/src/lib/crm/ai-response.ts`: `unmapped_model` joins
  the `invalid_request | api_error | internal | default` arm → **HTTP 502**
  with body `{ error: "AI service error" }`. It is a server-side
  misconfiguration, not a client or rate problem, so 502 (not 429/504) is
  correct; it is deliberately **not** a 500 / unhandled exception.

**Rationale:** a distinct code keeps the failure greppable in logs and
unambiguous versus a real upstream `api_error`, while reusing the existing 502
arm means no new front-end handling is required and the route already returns
clean JSON. **Rejected alternative:** reuse `internal` — works for HTTP, but
muddies logs/metrics by conflating "we have no price for this model" with
"unexpected crash."

### Net effect for an unmapped-model AI call

`aiComplete` returns `{ ok: false, error: { code: "unmapped_model", model,
message } }`; the CRM AI route returns **HTTP 502** with `{ error: "AI service
error" }`; a usage row is emitted with `status: "error"`, the real token
counts, `costMicros: 0`, and the clear `errorMessage`. No silent zero-cost
success, no page crash.

---

## 3. Scope / files to change

**In scope:**

| File | Change |
|---|---|
| `packages/ai-service/src/cost.ts` | Define + export `UnmappedModelError`; `calculateCostMicros` throws it instead of `return 0`; rewrite **both** stale comments — the `calculateCostMicros` doc comment (`cost.ts:42-47`, "Unknown model → returns 0 … Throwing here would lose visibility") **and** the `MODEL_PRICING` header comment (`cost.ts:24-27`, "or `calculateCostMicros` returns 0 and the cap can't be enforced") — to describe the fail-safe behaviour. |
| `packages/ai-service/src/types.ts` | Add `"unmapped_model"` to `AIErrorCode`; add `{ code: "unmapped_model"; model: string; message: string }` to the `AIError` union. |
| `packages/ai-service/src/client.ts` | Add `UnmappedModelError` branch to `mapError`; handle the unmapped case on the success path so the usage row preserves real token counts (status `error`). |
| `packages/ai-service/src/models.ts` | **Comment only** — update the note at `models.ts:18-19` ("or cost is recorded as 0 (see calculateCostMicros)") to describe fail-safe. Resolution logic unchanged (see out-of-scope). |
| `apps/web/src/lib/crm/ai-response.ts` | Add `case "unmapped_model"` to the 502 arm (explicit, even though `default` already covers it — keeps the mapping intentional and self-documenting). |
| `packages/ai-service/__tests__/cost.test.ts` | Add unmapped-model assertion (`.toThrow(UnmappedModelError)`); keep the locked price-table cases unchanged. Imports `UnmappedModelError` from `../src/cost` directly. |
| `packages/ai-service/__tests__/client.test.ts` | Add a test that an unmapped resolved model → `{ ok:false, error.code:"unmapped_model" }`, no silent success, and a `status:"error"` usage row with non-zero token counts. |
| Package barrel (`packages/ai-service/src/index.ts`) | Export `UnmappedModelError` from the barrel (deterministically, not conditionally) for consistency with the public failure-type pattern. `cost.test.ts` imports from `../src/cost` directly, so the `src/cost.ts` export is strictly sufficient; the barrel export fixes the type's public visibility here rather than leaving it for the implementer to guess. |

**Out of scope (do not touch):**

- RLS policies, SQL migrations, `drizzle-kit push`, any DB schema — protected.
- CI config, Dockerfile, AWS/infra.
- The `MODEL_PRICING` numbers themselves and `DEFAULT_MONTHLY_COST_LIMIT_MICROS`
  — values are locked; this change is about behaviour when a key is *missing*,
  not about prices.
- `models.ts` resolution logic — unchanged; it is allowed to resolve an
  unmapped id, and the fail-safe is what catches it downstream. (Only the stale
  comment at `models.ts:18-19` is touched — see in-scope.)
- `metering.ts` write/cap logic — unchanged; it already consumes `costMicros`
  correctly. We only stop feeding it a bogus 0.
- Adding new mapped models or env config.

---

## 4. Acceptance criteria (explicit, testable)

1. **Unmapped model surfaces a clear error, never a silent 0.**
   Calling `aiComplete` with a capability whose resolved model is absent from
   `MODEL_PRICING` returns `{ ok: false, error: { code: "unmapped_model",
   model, message } }` where `message` names the offending model id. It does
   **not** return `{ ok: true, costMicros: 0 }`. At the route level the call
   returns **HTTP 502** with `{ error: "AI service error" }` — never an
   unhandled 500 or a page crash. `aiComplete` still never throws past its
   boundary.

2. **Mapped-model math is unchanged — price-table lock holds.**
   `calculateCostMicros` for mapped models is byte-for-byte unchanged:
   - `claude-sonnet-4-6`, 1,000 in / 500 out = **10,500 micros**
     `(1000/1e6)*3e6 + (500/1e6)*15e6 = 3000 + 7500 = 10500`.
   - The existing locked 1M-in/1M-out cases stay green:
     `claude-haiku-4-5-20251001` = **6,000,000**,
     `claude-sonnet-4-6` = **18,000,000**, `claude-opus-4-8` = **30,000,000**.
   - The existing `client.test.ts` success case (10 in / 5 out → **105
     micros**, sonnet) stays green.

3. **Cap logic intact — mis-billed-at-0 usage can no longer slip under the $50
   cap.** An unmapped model never produces a `status:"success"` row, so it
   never rolls into `ai_usage_summary.totalCostMicros`; instead it fails the
   call. There is no longer any path where real token consumption is billed at
   0 and bypasses `DEFAULT_MONTHLY_COST_LIMIT_MICROS`. (The over-limit
   short-circuit for mapped models is unchanged.)

4. **Metering write-path unaffected for mapped models.** For any mapped model a
   successful call still calls `recordUsage` exactly once with the correct
   `costMicros` and `status:"success"`, and the summary UPSERT still
   accumulates. (Guarded by the existing, still-green client/metering tests.)

5. **The failed attempt remains visible.** The unmapped-model failure still
   emits exactly one usage row with `status:"error"`, the **real** token counts
   from the (mocked) Anthropic response, `costMicros: 0`, and the clear
   `errorMessage`. (This is stronger than the generic-catch fallback, which
   would record `ZERO_USAGE`; criterion 5 requires the real counts.)

---

## 5. Test obligations (derived from the acceptance criteria)

All tests run under the existing Vitest harness in `packages/ai-service`
(`cost.test.ts`, `client.test.ts`) — no new harness, no DB (client tests mock
metering and the Anthropic SDK as today).

- **AC2 (regression — must stay green, no edits to assertions):**
  - `cost.test.ts` price-table lock (haiku 6,000,000 / sonnet 18,000,000 / opus
    30,000,000).
  - `client.test.ts` success case (105 micros).
  - Add to `cost.test.ts`: `claude-sonnet-4-6` with `{1000 in, 500 out}` →
    `10_500` (explicit coverage of the brief's named case).

- **AC1 + AC5 (unit, `cost.test.ts`):**
  `expect(() => calculateCostMicros("claude-not-a-model", usage)).toThrow(
  UnmappedModelError)` and the thrown message contains the model id.

- **AC1 + AC5 (chokepoint, `client.test.ts`):**
  Drive an unmapped model — either via `baseRequest` whose capability resolves
  to an unmapped id (set an `AI_MODEL_*` env override to a junk id in the test,
  reset in `afterEach`) **or** by stubbing `resolveModelForCapability`. Assert:
  - `res.ok === false` and `res.error.code === "unmapped_model"`, `res.error.model`
    is the junk id;
  - `createMock` (Anthropic) *was* called (the API ran; the failure is
    post-response pricing) and the response carried non-zero tokens;
  - `recordUsage` called exactly once with `status: "error"`, `costMicros: 0`,
    and `tokenUsage` equal to the mocked response's real counts (not zeros);
  - `aiComplete` resolves (does not reject) — boundary contract preserved.

- **AC1 (route-level surface).** Assert the `AIError` → HTTP mapping for the new
  code. If a thin unit test of `aiErrorResponse` exists or is cheap to add,
  assert `aiErrorResponse({ code: "unmapped_model", model, message })` →
  `status 502`, body `{ error: "AI service error" }`. (The four CRM AI routes
  all funnel through `aiErrorResponse`, so one mapping test covers all of them;
  a full route integration test is **not** required by these criteria.)

These obligations come from the acceptance criteria above, not from the
implementation — each AC maps to at least one assertion.

---

## 6. Risks / edge cases

- **Env-var-configured model (`AI_MODEL_*`) not in `MODEL_PRICING`.** This is
  the *primary* real-world trigger (a model swap via env without a pricing
  entry). Now fails safe at the first call rather than silently under-billing.
  Note: the failure is **per-call at request time**, not at boot — there is no
  startup validation of env model ids. Acceptable for this scope; a future
  startup-time `MODEL_PRICING` coverage check over
  `DEFAULT_CAPABILITY_TO_MODEL` + resolved env vars is a possible follow-up
  (out of scope here).
- **`complex_analysis` / opus path.** `complex_analysis` resolves to
  `claude-opus-4-8`, which *is* mapped, so it is unaffected. Only an env
  override to an unmapped opus-tier id would trip the fail-safe — correct.
- **Token-count preservation vs. the generic catch.** The success-path handling
  must run *before* falling into the line-400 catch, otherwise the usage row
  records `ZERO_USAGE` and AC5 fails. The generic catch + `mapError` branch is
  retained purely as the never-throw backstop.
- **Cost = 0 for a *mapped* model is still legitimate** (e.g. 0 output tokens).
  The fail-safe keys off "model not in `MODEL_PRICING`", **not** off "cost ===
  0", so a genuine zero-cost mapped call is unaffected.
- **`AIError` union widening is a breaking type change for exhaustive
  switches.** Any `switch (error.code)` without a `default` would now fail
  exhaustiveness. `ai-response.ts` has a `default`, so it is safe; the explicit
  `case "unmapped_model"` is added anyway for clarity. Grep for other
  `error.code` consumers during implementation.
- **Doc realignment.** The `cost.ts` comment currently *advocates* the
  silent-zero behaviour ("Throwing here would lose visibility"). It must be
  rewritten, or code and comment will contradict each other and mislead the
  next reader. The "visibility" concern it raised is answered by AC5 (we still
  emit a row, now with real token counts).
```
