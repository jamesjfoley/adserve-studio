import type { FieldType, LocalizedLabel } from "@adserve/module-framework";

/**
 * Default field definitions for each CRM entity type. Task 0.6's
 * activation flow inserts these into `field_definitions` (with tenant
 * ID + entity type ID filled in) and creates a default `required` rule
 * in `validation_rules` for each field where `isRequired: true`.
 *
 * Naming:
 *   - `slug` is the key used in `records.data[slug]`. Lowercase, snake
 *     style if multi-word.
 *   - `labels` is the i18n-aware display label. Phase 1 populates `en`
 *     only.
 */

export interface CrmFieldDefinitionSpec {
  slug: string;
  name: string; // legacy name column — same as labels.en, here for the existing schema
  labels: LocalizedLabel;
  fieldType: FieldType;
  isRequired?: boolean;
  isUnique?: boolean;
  isSystem?: boolean;
  defaultValue?: unknown;
  options?: Record<string, unknown>;
  displayOrder: number;
  groupName?: string;
  description?: string;
  isSearchable?: boolean;
  isFilterable?: boolean;
}

// ============================================================
// Account fields
// ============================================================
export const DEFAULT_ACCOUNT_FIELDS: CrmFieldDefinitionSpec[] = [
  {
    slug: "name",
    name: "Name",
    labels: { en: "Name" },
    fieldType: "text",
    isRequired: true,
    isSystem: true,
    displayOrder: 10,
    isSearchable: true,
    isFilterable: true,
  },
  {
    slug: "website",
    name: "Website",
    labels: { en: "Website" },
    fieldType: "url",
    isSystem: true,
    displayOrder: 20,
    isSearchable: true,
  },
  {
    slug: "industry",
    name: "Industry",
    labels: { en: "Industry" },
    fieldType: "select",
    isSystem: true,
    displayOrder: 30,
    isFilterable: true,
    options: {
      choices: [
        { value: "technology", label: "Technology" },
        { value: "finance", label: "Finance" },
        { value: "healthcare", label: "Healthcare" },
        { value: "retail", label: "Retail" },
        { value: "manufacturing", label: "Manufacturing" },
        { value: "media", label: "Media" },
        { value: "other", label: "Other" },
      ],
    },
  },
  {
    slug: "status",
    name: "Status",
    labels: { en: "Status" },
    fieldType: "select",
    isRequired: true,
    isSystem: true,
    defaultValue: "prospect",
    displayOrder: 40,
    isFilterable: true,
    options: {
      choices: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
        { value: "prospect", label: "Prospect" },
      ],
    },
  },
  {
    slug: "phone",
    name: "Phone",
    labels: { en: "Phone" },
    fieldType: "phone",
    isSystem: true,
    displayOrder: 50,
  },
  {
    slug: "email",
    name: "Email",
    labels: { en: "Email" },
    fieldType: "email",
    isSystem: true,
    displayOrder: 60,
    isSearchable: true,
  },
  {
    slug: "annualRevenue",
    name: "Annual revenue",
    labels: { en: "Annual revenue" },
    fieldType: "currency",
    displayOrder: 70,
    groupName: "Financials",
    isFilterable: true,
  },
  {
    slug: "employeeCount",
    name: "Employee count",
    labels: { en: "Employee count" },
    fieldType: "number",
    displayOrder: 80,
    groupName: "Financials",
    isFilterable: true,
  },
  {
    slug: "description",
    name: "Description",
    labels: { en: "Description" },
    fieldType: "long_text",
    displayOrder: 90,
  },
];

// ============================================================
// Contact fields
// ============================================================
export const DEFAULT_CONTACT_FIELDS: CrmFieldDefinitionSpec[] = [
  {
    slug: "firstName",
    name: "First name",
    labels: { en: "First name" },
    fieldType: "text",
    isRequired: true,
    isSystem: true,
    displayOrder: 10,
    isSearchable: true,
  },
  {
    slug: "lastName",
    name: "Last name",
    labels: { en: "Last name" },
    fieldType: "text",
    isRequired: true,
    isSystem: true,
    displayOrder: 20,
    isSearchable: true,
  },
  {
    slug: "email",
    name: "Email",
    labels: { en: "Email" },
    fieldType: "email",
    isSystem: true,
    displayOrder: 30,
    isSearchable: true,
  },
  {
    slug: "phone",
    name: "Phone",
    labels: { en: "Phone" },
    fieldType: "phone",
    isSystem: true,
    displayOrder: 40,
  },
  {
    slug: "title",
    name: "Title",
    labels: { en: "Title" },
    fieldType: "text",
    isSystem: true,
    displayOrder: 50,
  },
  {
    slug: "status",
    name: "Status",
    labels: { en: "Status" },
    fieldType: "select",
    isRequired: true,
    isSystem: true,
    defaultValue: "active",
    displayOrder: 60,
    isFilterable: true,
    options: {
      choices: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
      ],
    },
  },
  {
    slug: "department",
    name: "Department",
    labels: { en: "Department" },
    fieldType: "text",
    displayOrder: 70,
  },
  {
    slug: "linkedinUrl",
    name: "LinkedIn",
    labels: { en: "LinkedIn" },
    fieldType: "url",
    displayOrder: 80,
  },
  {
    slug: "notes",
    name: "Notes",
    labels: { en: "Notes" },
    fieldType: "long_text",
    displayOrder: 90,
  },
];

// ============================================================
// Lead fields
// ============================================================
export const DEFAULT_LEAD_FIELDS: CrmFieldDefinitionSpec[] = [
  {
    slug: "firstName",
    name: "First name",
    labels: { en: "First name" },
    fieldType: "text",
    isRequired: true,
    isSystem: true,
    displayOrder: 10,
    isSearchable: true,
  },
  {
    slug: "lastName",
    name: "Last name",
    labels: { en: "Last name" },
    fieldType: "text",
    isRequired: true,
    isSystem: true,
    displayOrder: 20,
    isSearchable: true,
  },
  {
    slug: "email",
    name: "Email",
    labels: { en: "Email" },
    fieldType: "email",
    isSystem: true,
    displayOrder: 30,
    isSearchable: true,
  },
  {
    slug: "company",
    name: "Company",
    labels: { en: "Company" },
    fieldType: "text",
    isSystem: true,
    displayOrder: 40,
    isSearchable: true,
  },
  {
    slug: "source",
    name: "Source",
    labels: { en: "Source" },
    fieldType: "select",
    isRequired: true,
    isSystem: true,
    defaultValue: "other",
    displayOrder: 50,
    isFilterable: true,
    options: {
      choices: [
        { value: "web", label: "Web" },
        { value: "referral", label: "Referral" },
        { value: "event", label: "Event" },
        { value: "cold", label: "Cold outreach" },
        { value: "other", label: "Other" },
      ],
    },
  },
  {
    slug: "status",
    name: "Status",
    labels: { en: "Status" },
    fieldType: "select",
    isRequired: true,
    isSystem: true,
    defaultValue: "new",
    displayOrder: 60,
    isFilterable: true,
    options: {
      choices: [
        { value: "new", label: "New" },
        { value: "contacted", label: "Contacted" },
        { value: "qualified", label: "Qualified" },
        { value: "converted", label: "Converted" },
        { value: "lost", label: "Lost" },
      ],
    },
  },
  {
    slug: "estimatedValue",
    name: "Estimated value",
    labels: { en: "Estimated value" },
    fieldType: "currency",
    displayOrder: 70,
  },
  {
    slug: "notes",
    name: "Notes",
    labels: { en: "Notes" },
    fieldType: "long_text",
    displayOrder: 80,
  },
];

// ============================================================
// Opportunity fields
// ============================================================
export const DEFAULT_OPPORTUNITY_FIELDS: CrmFieldDefinitionSpec[] = [
  {
    slug: "name",
    name: "Name",
    labels: { en: "Name" },
    fieldType: "text",
    isRequired: true,
    isSystem: true,
    displayOrder: 10,
    isSearchable: true,
  },
  {
    slug: "stage",
    name: "Stage",
    labels: { en: "Stage" },
    fieldType: "select",
    isRequired: true,
    isSystem: true,
    displayOrder: 20,
    isFilterable: true,
    // Choices populated from the tenant's pipeline_stages config at
    // activation time — see ./pipeline.ts.
    options: { choicesFrom: "pipeline_stages" },
  },
  {
    slug: "amount",
    name: "Amount",
    labels: { en: "Amount" },
    fieldType: "currency",
    isSystem: true,
    displayOrder: 30,
    isFilterable: true,
  },
  {
    slug: "closeDate",
    name: "Close date",
    labels: { en: "Close date" },
    fieldType: "date",
    isSystem: true,
    displayOrder: 40,
    isFilterable: true,
  },
  {
    slug: "probability",
    name: "Probability (%)",
    labels: { en: "Probability (%)" },
    fieldType: "number",
    isSystem: true,
    displayOrder: 50,
    options: { min: 0, max: 100 },
  },
  {
    slug: "description",
    name: "Description",
    labels: { en: "Description" },
    fieldType: "long_text",
    displayOrder: 60,
  },
  {
    slug: "nextStep",
    name: "Next step",
    labels: { en: "Next step" },
    fieldType: "text",
    displayOrder: 70,
  },
  {
    slug: "lostReason",
    name: "Lost reason",
    labels: { en: "Lost reason" },
    fieldType: "select",
    displayOrder: 80,
    options: {
      choices: [
        { value: "price", label: "Price" },
        { value: "competitor", label: "Lost to competitor" },
        { value: "timing", label: "Timing" },
        { value: "no_decision", label: "No decision made" },
        { value: "other", label: "Other" },
      ],
    },
  },
];

/**
 * Convenience map from entity type slug → default field defs.
 * Task 0.6's activation flow uses this to drive provisioning.
 */
export const DEFAULT_FIELDS_BY_ENTITY: Record<string, CrmFieldDefinitionSpec[]> = {
  account: DEFAULT_ACCOUNT_FIELDS,
  contact: DEFAULT_CONTACT_FIELDS,
  lead: DEFAULT_LEAD_FIELDS,
  opportunity: DEFAULT_OPPORTUNITY_FIELDS,
};
