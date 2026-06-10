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
// Account fields are grouped into PANELS via `groupName` — "Account Details"
// (first panel, always open), then "Credit Approvals", "Financial Controls",
// "Addresses". `generateDefaultLayoutConfig` turns each group into a layout
// section (ordered by min displayOrder), so the default detail mirrors the
// panels below; the admin can then add/remove/reorder panels + move fields via
// the layout editor (the persisted layout, not this list, is then the source
// of truth). Brands + Account History are separate (non-field) panels rendered
// by the detail page.
//
// NOTE: only `name` is required. The Account-Type / Required-credit-limit /
// Company-registration fields are starred in the design but kept OPTIONAL here
// because Lead-convert and Campaign create-with-account auto-create accounts
// with minimal data — enforcing them would break those flows (Production
// Consideration).
export const DEFAULT_ACCOUNT_FIELDS: CrmFieldDefinitionSpec[] = [
  // ---- Account Details ----
  {
    slug: "name",
    name: "Account name",
    labels: { en: "Account name" },
    fieldType: "text",
    isRequired: true,
    isSystem: true,
    groupName: "Account Details",
    displayOrder: 10,
    isSearchable: true,
    isFilterable: true,
  },
  {
    slug: "knownAs",
    name: "Known as name",
    labels: { en: "Known as name" },
    fieldType: "text",
    isSystem: true,
    groupName: "Account Details",
    displayOrder: 20,
    isSearchable: true,
  },
  {
    slug: "accountType",
    name: "Account type",
    labels: { en: "Account type" },
    fieldType: "select",
    isSystem: true,
    groupName: "Account Details",
    displayOrder: 30,
    isFilterable: true,
    options: {
      choices: [
        { value: "advertiser", label: "Advertiser" },
        { value: "agency", label: "Agency" },
        { value: "advertiser_agency", label: "Advertiser & Agency" },
        { value: "other", label: "Other" },
      ],
    },
  },
  {
    slug: "accountRating",
    name: "Account rating",
    labels: { en: "Account rating" },
    fieldType: "select",
    isSystem: true,
    groupName: "Account Details",
    displayOrder: 40,
    isFilterable: true,
    options: {
      choices: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
        { value: "c", label: "C" },
        { value: "unrated", label: "Unrated" },
      ],
    },
  },
  {
    slug: "phone",
    name: "Main telephone",
    labels: { en: "Main telephone" },
    fieldType: "phone",
    isSystem: true,
    groupName: "Account Details",
    displayOrder: 50,
  },
  {
    slug: "website",
    name: "Company website",
    labels: { en: "Company website" },
    fieldType: "url",
    isSystem: true,
    groupName: "Account Details",
    displayOrder: 60,
    isSearchable: true,
  },
  {
    // Parent account — a plain text field for the prototype (stores the parent
    // account's name; persists via the normal form). Wiring it as a true
    // account→account relationship picker is a follow-up.
    slug: "parentAccount",
    name: "Parent account",
    labels: { en: "Parent account" },
    fieldType: "text",
    isSystem: true,
    groupName: "Account Details",
    displayOrder: 70,
  },
  {
    slug: "accountStationExclusions",
    name: "Account station exclusions",
    labels: { en: "Account station exclusions" },
    fieldType: "multi_select",
    isSystem: true,
    groupName: "Account Details",
    displayOrder: 80,
    options: {
      choices: [
        { value: "ghr_tayside_fife", label: "Greatest Hits Radio (Tayside & Fife)" },
        { value: "capital_london", label: "Capital London" },
        { value: "heart_national", label: "Heart (National)" },
        { value: "lbc", label: "LBC" },
      ],
    },
  },
  {
    slug: "defaultCategory",
    name: "Default category",
    labels: { en: "Default category" },
    fieldType: "select",
    isSystem: true,
    groupName: "Account Details",
    displayOrder: 90,
    options: {
      choices: [
        { value: "retail", label: "Retail" },
        { value: "automotive", label: "Automotive" },
        { value: "finance", label: "Finance" },
        { value: "government", label: "Government" },
        { value: "leisure", label: "Leisure" },
        { value: "other", label: "Other" },
      ],
    },
  },
  {
    slug: "accountOwner",
    name: "Account owner",
    labels: { en: "Account owner" },
    fieldType: "text",
    isSystem: true,
    groupName: "Account Details",
    displayOrder: 100,
  },
  {
    slug: "accountValues",
    name: "Account values (for copy generation purposes)",
    labels: { en: "Account values (for copy generation purposes)" },
    fieldType: "long_text",
    isSystem: true,
    groupName: "Account Details",
    displayOrder: 110,
  },
  {
    slug: "industry",
    name: "Industry",
    labels: { en: "Industry" },
    fieldType: "select",
    isSystem: true,
    groupName: "Account Details",
    displayOrder: 120,
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
    slug: "email",
    name: "Email",
    labels: { en: "Email" },
    fieldType: "email",
    isSystem: true,
    groupName: "Account Details",
    displayOrder: 130,
    isSearchable: true,
  },
  {
    slug: "description",
    name: "Description",
    labels: { en: "Description" },
    fieldType: "long_text",
    isSystem: true,
    groupName: "Account Details",
    displayOrder: 140,
  },
  {
    slug: "governmentAccount",
    name: "Government account",
    labels: { en: "Government account" },
    fieldType: "boolean",
    isSystem: true,
    groupName: "Account Details",
    displayOrder: 150,
  },
  {
    slug: "poNumbersMandatory",
    name: "Are PO numbers mandatory?",
    labels: { en: "Are PO numbers mandatory?" },
    fieldType: "boolean",
    isSystem: true,
    groupName: "Account Details",
    displayOrder: 152,
  },
  {
    slug: "jcnMandatory",
    name: "Is JCN mandatory?",
    labels: { en: "Is JCN mandatory?" },
    fieldType: "boolean",
    isSystem: true,
    groupName: "Account Details",
    displayOrder: 154,
  },
  {
    slug: "noMultipleCampaignsSameBreak",
    name: "Do not permit multiple campaigns in the same break",
    labels: { en: "Do not permit multiple campaigns in the same break" },
    fieldType: "boolean",
    isSystem: true,
    groupName: "Account Details",
    displayOrder: 156,
  },

  // ---- Credit Approvals ----
  {
    slug: "creditStatus",
    name: "Credit status",
    labels: { en: "Credit status" },
    fieldType: "select",
    isSystem: true,
    groupName: "Credit Approvals",
    displayOrder: 200,
    isFilterable: true,
    options: {
      choices: [
        { value: "approved", label: "Approved" },
        { value: "pending", label: "Pending" },
        { value: "declined", label: "Declined" },
        { value: "on_hold", label: "On hold" },
      ],
    },
  },
  {
    slug: "requiredCreditLimit",
    name: "Required credit limit (£)",
    labels: { en: "Required credit limit (£)" },
    fieldType: "currency",
    isSystem: true,
    groupName: "Credit Approvals",
    displayOrder: 210,
  },
  {
    slug: "creditType",
    name: "Credit type",
    labels: { en: "Credit type" },
    fieldType: "select",
    isSystem: true,
    groupName: "Credit Approvals",
    displayOrder: 220,
    options: {
      choices: [
        { value: "on_account", label: "On Account" },
        { value: "pro_forma", label: "Pro Forma" },
        { value: "prepayment", label: "Prepayment" },
      ],
    },
  },
  {
    // Computed/approved limit — read-only in the form (set by credit control).
    slug: "creditLimit",
    name: "Credit limit (£)",
    labels: { en: "Credit limit (£)" },
    fieldType: "currency",
    isSystem: true,
    groupName: "Credit Approvals",
    displayOrder: 230,
    options: { readOnly: true },
  },
  {
    slug: "creditBalance",
    name: "Credit balance",
    labels: { en: "Credit balance" },
    fieldType: "currency",
    isSystem: true,
    groupName: "Credit Approvals",
    displayOrder: 240,
    options: { readOnly: true },
  },

  // ---- Financial Controls ----
  {
    slug: "paymentTerms",
    name: "Payment terms",
    labels: { en: "Payment terms" },
    fieldType: "select",
    isSystem: true,
    groupName: "Financial Controls",
    displayOrder: 300,
    options: {
      choices: [
        { value: "15_days", label: "15 Days" },
        { value: "30_days", label: "30 Days" },
        { value: "60_days", label: "60 Days" },
        { value: "90_days", label: "90 Days" },
      ],
    },
  },
  {
    slug: "commissionPct",
    name: "Commission %",
    labels: { en: "Commission %" },
    fieldType: "number",
    isSystem: true,
    groupName: "Financial Controls",
    displayOrder: 310,
    options: { min: 0, max: 100 },
  },
  {
    slug: "vatCode",
    name: "VAT code",
    labels: { en: "VAT code" },
    fieldType: "select",
    isSystem: true,
    groupName: "Financial Controls",
    displayOrder: 320,
    options: {
      choices: [
        { value: "no_vat", label: "No VAT (0%)" },
        { value: "standard", label: "Standard (20%)" },
        { value: "reduced", label: "Reduced (5%)" },
        { value: "exempt", label: "Exempt" },
      ],
    },
  },
  {
    slug: "status",
    name: "Account status",
    labels: { en: "Account status" },
    fieldType: "select",
    isRequired: true,
    isSystem: true,
    defaultValue: "prospect",
    groupName: "Financial Controls",
    displayOrder: 330,
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
    slug: "billingCurrency",
    name: "Billing currency",
    labels: { en: "Billing currency" },
    fieldType: "select",
    isSystem: true,
    groupName: "Financial Controls",
    displayOrder: 340,
    options: {
      choices: [
        { value: "GBP", label: "GBP" },
        { value: "USD", label: "USD" },
        { value: "EUR", label: "EUR" },
        { value: "AUD", label: "AUD" },
      ],
    },
  },
  {
    slug: "companyRegistrationNumber",
    name: "Company registration number",
    labels: { en: "Company registration number" },
    fieldType: "text",
    isSystem: true,
    groupName: "Financial Controls",
    displayOrder: 350,
  },
  {
    slug: "vatNumber",
    name: "VAT number",
    labels: { en: "VAT number" },
    fieldType: "text",
    isSystem: true,
    groupName: "Financial Controls",
    displayOrder: 360,
  },
  {
    slug: "iban",
    name: "IBAN",
    labels: { en: "IBAN" },
    fieldType: "text",
    isSystem: true,
    groupName: "Financial Controls",
    displayOrder: 370,
  },
  {
    slug: "annualRevenue",
    name: "Annual revenue",
    labels: { en: "Annual revenue" },
    fieldType: "currency",
    isSystem: true,
    groupName: "Financial Controls",
    displayOrder: 380,
    isFilterable: true,
  },
  {
    slug: "employeeCount",
    name: "Employee count",
    labels: { en: "Employee count" },
    fieldType: "number",
    isSystem: true,
    groupName: "Financial Controls",
    displayOrder: 385,
    isFilterable: true,
  },
  {
    slug: "suppressInvoice",
    name: "Suppress invoice",
    labels: { en: "Suppress invoice" },
    fieldType: "boolean",
    isSystem: true,
    groupName: "Financial Controls",
    displayOrder: 390,
  },

  // ---- Addresses (Site + Billing; "Billing same as site" disables billing) ----
  {
    slug: "addressLine1",
    name: "Site address – line 1",
    labels: { en: "Site address – line 1" },
    fieldType: "text",
    isSystem: true,
    groupName: "Addresses",
    displayOrder: 400,
  },
  {
    slug: "addressLine2",
    name: "Site address – line 2",
    labels: { en: "Site address – line 2" },
    fieldType: "text",
    isSystem: true,
    groupName: "Addresses",
    displayOrder: 410,
  },
  {
    slug: "city",
    name: "Site address – City",
    labels: { en: "Site address – City" },
    fieldType: "text",
    isSystem: true,
    groupName: "Addresses",
    displayOrder: 420,
  },
  {
    slug: "stateCounty",
    name: "Site address – State / County",
    labels: { en: "Site address – State / County" },
    fieldType: "text",
    isSystem: true,
    groupName: "Addresses",
    displayOrder: 430,
  },
  {
    slug: "postcode",
    name: "Site address – Post code / Zip",
    labels: { en: "Site address – Post code / Zip" },
    fieldType: "text",
    isSystem: true,
    groupName: "Addresses",
    displayOrder: 440,
  },
  {
    slug: "country",
    name: "Site address – Country",
    labels: { en: "Site address – Country" },
    fieldType: "text",
    isSystem: true,
    groupName: "Addresses",
    displayOrder: 450,
  },
  {
    slug: "billingSameAsSite",
    name: "Billing address same as site address",
    labels: { en: "Billing address same as site address" },
    fieldType: "boolean",
    isSystem: true,
    groupName: "Addresses",
    displayOrder: 455,
  },
  {
    slug: "billingAddressLine1",
    name: "Billing address – line 1",
    labels: { en: "Billing address – line 1" },
    fieldType: "text",
    isSystem: true,
    groupName: "Addresses",
    displayOrder: 460,
    options: { disabledWhen: { field: "billingSameAsSite", equals: true } },
  },
  {
    slug: "billingAddressLine2",
    name: "Billing address – line 2",
    labels: { en: "Billing address – line 2" },
    fieldType: "text",
    isSystem: true,
    groupName: "Addresses",
    displayOrder: 470,
    options: { disabledWhen: { field: "billingSameAsSite", equals: true } },
  },
  {
    slug: "billingCity",
    name: "Billing address – City",
    labels: { en: "Billing address – City" },
    fieldType: "text",
    isSystem: true,
    groupName: "Addresses",
    displayOrder: 480,
    options: { disabledWhen: { field: "billingSameAsSite", equals: true } },
  },
  {
    slug: "billingStateCounty",
    name: "Billing address – State / County",
    labels: { en: "Billing address – State / County" },
    fieldType: "text",
    isSystem: true,
    groupName: "Addresses",
    displayOrder: 490,
    options: { disabledWhen: { field: "billingSameAsSite", equals: true } },
  },
  {
    slug: "billingPostcode",
    name: "Billing address – Post code / Zip",
    labels: { en: "Billing address – Post code / Zip" },
    fieldType: "text",
    isSystem: true,
    groupName: "Addresses",
    displayOrder: 500,
    options: { disabledWhen: { field: "billingSameAsSite", equals: true } },
  },
  {
    slug: "billingCountry",
    name: "Billing address – Country",
    labels: { en: "Billing address – Country" },
    fieldType: "text",
    isSystem: true,
    groupName: "Addresses",
    displayOrder: 510,
    options: { disabledWhen: { field: "billingSameAsSite", equals: true } },
  },
];

// ============================================================
// Contact fields
// ============================================================
// Contact fields are grouped into PANELS via `groupName` ("General", "Social",
// "Site address", "More"). `generateDefaultLayoutConfig` turns each group into a
// layout section, so the default form mirrors the panels below — and the admin
// can then add/remove panels and move fields between them via the layout editor
// (the layout, not this list, is the source of truth once persisted).
export const DEFAULT_CONTACT_FIELDS: CrmFieldDefinitionSpec[] = [
  // ---- General ----
  {
    slug: "salutation",
    name: "Salutation",
    labels: { en: "Salutation" },
    fieldType: "select",
    isSystem: true,
    groupName: "General",
    displayOrder: 10,
    options: {
      choices: [
        { value: "mr", label: "Mr" },
        { value: "mrs", label: "Mrs" },
        { value: "ms", label: "Ms" },
        { value: "miss", label: "Miss" },
        { value: "dr", label: "Dr" },
        { value: "prof", label: "Prof" },
        { value: "mx", label: "Mx" },
      ],
    },
  },
  {
    slug: "firstName",
    name: "First name",
    labels: { en: "First name" },
    fieldType: "text",
    isRequired: true,
    isSystem: true,
    groupName: "General",
    displayOrder: 20,
    isSearchable: true,
  },
  {
    slug: "lastName",
    name: "Last name",
    labels: { en: "Last name" },
    fieldType: "text",
    isRequired: true,
    isSystem: true,
    groupName: "General",
    displayOrder: 30,
    isSearchable: true,
  },
  {
    slug: "knownAsName",
    name: "Known as name",
    labels: { en: "Known as name" },
    fieldType: "text",
    isSystem: true,
    groupName: "General",
    displayOrder: 40,
  },
  {
    // The contact's PRIMARY account, backed by `contact_belongs_to_account`
    // (record_relationships, NOT records.data). Rendered inline via the
    // RelationshipField account picker; admin-placeable like any field.
    slug: "account",
    name: "Account name",
    labels: { en: "Account name" },
    fieldType: "relationship",
    isSystem: true,
    groupName: "General",
    displayOrder: 50,
    // Data-driven picker config (RelationshipField reads this, not the slug).
    options: { relationship: { targetSlug: "account", allowCreate: true } },
  },
  {
    // Org hierarchy: who this contact reports to, backed by
    // `contact_reports_to_contact` (record_relationships). Rendered inline as a
    // contact lookup (RelationshipField).
    slug: "reportsTo",
    name: "Reports to",
    labels: { en: "Reports to" },
    fieldType: "relationship",
    isSystem: true,
    groupName: "General",
    displayOrder: 55,
    options: { relationship: { targetSlug: "contact", allowCreate: false } },
  },
  {
    slug: "title",
    name: "Job title",
    labels: { en: "Job title" },
    fieldType: "text",
    isSystem: true,
    groupName: "General",
    displayOrder: 60,
  },
  {
    slug: "email",
    name: "Email - Work",
    labels: { en: "Email - Work" },
    fieldType: "email",
    isSystem: true,
    groupName: "General",
    displayOrder: 70,
    isSearchable: true,
  },
  {
    slug: "emailOther",
    name: "Email - Other",
    labels: { en: "Email - Other" },
    fieldType: "email",
    isSystem: true,
    groupName: "General",
    displayOrder: 80,
  },
  {
    slug: "mobile",
    name: "Mobile",
    labels: { en: "Mobile" },
    fieldType: "phone",
    isSystem: true,
    groupName: "General",
    displayOrder: 90,
  },
  {
    slug: "phone",
    name: "Landline",
    labels: { en: "Landline" },
    fieldType: "phone",
    isSystem: true,
    groupName: "General",
    displayOrder: 100,
  },
  {
    slug: "status",
    name: "Status",
    labels: { en: "Status" },
    fieldType: "select",
    isRequired: true,
    isSystem: true,
    defaultValue: "active",
    groupName: "General",
    displayOrder: 110,
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
    groupName: "General",
    displayOrder: 120,
  },
  {
    slug: "billingContact",
    name: "Billing contact",
    labels: { en: "Billing contact" },
    fieldType: "boolean",
    isSystem: true,
    groupName: "General",
    displayOrder: 130,
  },
  // ---- Social ----
  {
    slug: "linkedinUrl",
    name: "LinkedIn",
    labels: { en: "LinkedIn" },
    fieldType: "url",
    groupName: "Social",
    displayOrder: 210,
  },
  {
    slug: "facebook",
    name: "Facebook",
    labels: { en: "Facebook" },
    fieldType: "url",
    groupName: "Social",
    displayOrder: 220,
  },
  {
    slug: "twitter",
    name: "Twitter",
    labels: { en: "Twitter" },
    fieldType: "url",
    groupName: "Social",
    displayOrder: 230,
  },
  {
    slug: "otherSocial",
    name: "Other",
    labels: { en: "Other" },
    fieldType: "url",
    groupName: "Social",
    displayOrder: 240,
  },
  // ---- Site address ----
  {
    // When true, the contact's site address is inherited (copied) from its
    // primary account's address on save.
    slug: "sameAsAccountAddress",
    name: "Same as Site account address",
    labels: { en: "Same as Site account address" },
    fieldType: "boolean",
    isSystem: true,
    groupName: "Site address",
    displayOrder: 305,
  },
  {
    slug: "siteAddressLine1",
    name: "Site address line 1",
    labels: { en: "Site address line 1" },
    fieldType: "text",
    isSystem: true,
    groupName: "Site address",
    displayOrder: 310,
    options: { disabledWhen: { field: "sameAsAccountAddress", equals: true } },
  },
  {
    slug: "siteAddressLine2",
    name: "Site address line 2",
    labels: { en: "Site address line 2" },
    fieldType: "text",
    isSystem: true,
    groupName: "Site address",
    displayOrder: 320,
    options: { disabledWhen: { field: "sameAsAccountAddress", equals: true } },
  },
  {
    slug: "city",
    name: "City",
    labels: { en: "City" },
    fieldType: "text",
    isSystem: true,
    groupName: "Site address",
    displayOrder: 330,
    options: { disabledWhen: { field: "sameAsAccountAddress", equals: true } },
  },
  {
    slug: "stateCounty",
    name: "State / County",
    labels: { en: "State / County" },
    fieldType: "text",
    isSystem: true,
    groupName: "Site address",
    displayOrder: 340,
    options: { disabledWhen: { field: "sameAsAccountAddress", equals: true } },
  },
  {
    slug: "postcode",
    name: "Postcode",
    labels: { en: "Postcode" },
    fieldType: "text",
    isSystem: true,
    groupName: "Site address",
    displayOrder: 350,
    options: { disabledWhen: { field: "sameAsAccountAddress", equals: true } },
  },
  {
    slug: "country",
    name: "Country",
    labels: { en: "Country" },
    fieldType: "text",
    isSystem: true,
    groupName: "Site address",
    displayOrder: 360,
    options: { disabledWhen: { field: "sameAsAccountAddress", equals: true } },
  },
  // ---- More ----
  {
    slug: "notes",
    name: "Notes",
    labels: { en: "Notes" },
    fieldType: "long_text",
    groupName: "More",
    displayOrder: 410,
  },
  {
    slug: "externalReferenceId",
    name: "External reference ID",
    labels: { en: "External reference ID" },
    fieldType: "text",
    isSystem: true,
    groupName: "More",
    displayOrder: 420,
  },
  {
    slug: "makeFavourite",
    name: "Make favourite",
    labels: { en: "Make favourite" },
    fieldType: "boolean",
    isSystem: true,
    groupName: "More",
    displayOrder: 430,
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

// ============================================================
// Campaign fields (media-first pipeline object)
// ============================================================
export const DEFAULT_CAMPAIGN_FIELDS: CrmFieldDefinitionSpec[] = [
  {
    slug: "name",
    name: "Name",
    labels: { en: "Name" },
    fieldType: "text",
    isRequired: true,
    isSystem: true,
    groupName: "General",
    displayOrder: 10,
    isSearchable: true,
  },
  {
    // Owning Account, backed by `campaign_belongs_to_account` (M2O,
    // record_relationships — NOT records.data). Required: a campaign always
    // belongs to one advertiser/agency. Rendered inline via the
    // RelationshipField account picker (mirrors contact.account).
    slug: "account",
    name: "Account",
    labels: { en: "Account" },
    fieldType: "relationship",
    isRequired: true,
    isSystem: true,
    groupName: "General",
    displayOrder: 20,
    options: { relationship: { targetSlug: "account", allowCreate: true } },
  },
  {
    // Optional primary Contact, backed by `campaign_has_primary_contact`
    // (M2M with metadata.isPrimary — mirrors opportunity_has_primary_contact).
    slug: "primaryContact",
    name: "Primary contact",
    labels: { en: "Primary contact" },
    fieldType: "relationship",
    isSystem: true,
    groupName: "General",
    displayOrder: 30,
    options: { relationship: { targetSlug: "contact", allowCreate: false } },
  },
  {
    slug: "value",
    name: "Value / budget",
    labels: { en: "Value / budget" },
    fieldType: "currency",
    isSystem: true,
    groupName: "General",
    displayOrder: 40,
    isFilterable: true,
  },
  {
    slug: "stage",
    name: "Stage",
    labels: { en: "Stage" },
    fieldType: "select",
    isRequired: true,
    isSystem: true,
    groupName: "General",
    displayOrder: 50,
    isFilterable: true,
    // Fixed campaign enum (NOT the opportunity pipeline_stages). Choices are
    // resolved from CAMPAIGN_STAGES at activation time — see ./activate.ts.
    options: { choicesFrom: "campaign_stages" },
  },
  {
    slug: "flightStart",
    name: "Flight start",
    labels: { en: "Flight start" },
    fieldType: "date",
    isSystem: true,
    groupName: "Flight",
    displayOrder: 60,
    isFilterable: true,
  },
  {
    slug: "flightEnd",
    name: "Flight end",
    labels: { en: "Flight end" },
    fieldType: "date",
    isSystem: true,
    groupName: "Flight",
    displayOrder: 70,
    isFilterable: true,
  },
  {
    slug: "products",
    name: "Products / inventory",
    labels: { en: "Products / inventory" },
    fieldType: "long_text",
    isSystem: true,
    groupName: "Flight",
    displayOrder: 80,
  },
  {
    slug: "pcaOutcome",
    name: "PCA outcome",
    labels: { en: "PCA outcome" },
    fieldType: "long_text",
    groupName: "Delivery",
    displayOrder: 90,
  },
  {
    // Stub reference to an operational (Planning/Trafficking) campaign,
    // populated at the Booking stage. No FK; NOT wired into Planning for the
    // prototype (Production Consideration).
    slug: "opsCampaignId",
    name: "Ops campaign ID",
    labels: { en: "Ops campaign ID" },
    fieldType: "text",
    groupName: "Delivery",
    displayOrder: 100,
  },
];

// ============================================================
// Brand fields (child of Account — managed via the Account "Brands" panel)
// ============================================================
export const DEFAULT_BRAND_FIELDS: CrmFieldDefinitionSpec[] = [
  {
    slug: "name",
    name: "Brand",
    labels: { en: "Brand" },
    fieldType: "text",
    isRequired: true,
    isSystem: true,
    displayOrder: 10,
    isSearchable: true,
  },
  {
    slug: "category",
    name: "Brand Category",
    labels: { en: "Brand Category" },
    fieldType: "select",
    isSystem: true,
    displayOrder: 20,
    isFilterable: true,
    options: {
      choices: [
        { value: "government", label: "Government" },
        { value: "retail", label: "Retail" },
        { value: "automotive", label: "Automotive" },
        { value: "finance", label: "Finance" },
        { value: "fmcg", label: "FMCG" },
        { value: "leisure", label: "Leisure" },
        { value: "other", label: "Other" },
      ],
    },
  },
  {
    slug: "values",
    name: "Brand Values",
    labels: { en: "Brand Values" },
    fieldType: "text",
    isSystem: true,
    displayOrder: 30,
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
  campaign: DEFAULT_CAMPAIGN_FIELDS,
  brand: DEFAULT_BRAND_FIELDS,
};
