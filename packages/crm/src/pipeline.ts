/**
 * Default opportunity pipeline stages.
 *
 * Stored per-tenant in `entity_types.settings.pipelineStages` (per Task
 * 0.6) so each tenant can rename, reorder, add, or remove stages
 * without affecting other tenants. The defaults below seed a sensible
 * starting point — enterprise-CRM-shaped (Qualification → Proposal →
 * Closed Won/Lost).
 *
 * `defaultProbability` is what auto-populates the opportunity's
 * `probability` field when a user moves it into that stage. Users can
 * still override per opportunity.
 */

export interface PipelineStageSpec {
  slug: string;
  name: string;
  displayOrder: number;
  /** 0-100 inclusive. Closed Lost is 0; Closed Won is 100. */
  defaultProbability: number;
  /**
   * Marks Closed Won / Closed Lost. NB: the Task 1.5 kanban does NOT
   * enforce a forward-only flow in v1 — cards can move freely between any
   * stages, including back out of a closed stage (re-opening a deal is
   * legitimate). WIP/flow constraints are a deferred enhancement.
   */
  isClosed: boolean;
  /** Closed Won contributes to revenue forecast; Closed Lost does not. */
  isWon: boolean;
}

export const DEFAULT_PIPELINE_STAGES: PipelineStageSpec[] = [
  {
    slug: "qualification",
    name: "Qualification",
    displayOrder: 10,
    defaultProbability: 10,
    isClosed: false,
    isWon: false,
  },
  {
    slug: "needs_analysis",
    name: "Needs analysis",
    displayOrder: 20,
    defaultProbability: 25,
    isClosed: false,
    isWon: false,
  },
  {
    slug: "proposal",
    name: "Proposal",
    displayOrder: 30,
    defaultProbability: 50,
    isClosed: false,
    isWon: false,
  },
  {
    slug: "negotiation",
    name: "Negotiation",
    displayOrder: 40,
    defaultProbability: 75,
    isClosed: false,
    isWon: false,
  },
  {
    slug: "closed_won",
    name: "Closed won",
    displayOrder: 50,
    defaultProbability: 100,
    isClosed: true,
    isWon: true,
  },
  {
    slug: "closed_lost",
    name: "Closed lost",
    displayOrder: 60,
    defaultProbability: 0,
    isClosed: true,
    isWon: false,
  },
];
