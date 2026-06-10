import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { db, migrationClient } from "../client";
import {
  records,
  recordRelationships,
  entityTypes,
  schemaRelationships,
  tenants,
} from "../schema";

/**
 * Generate ~100 realistic Account records, each with 5–20 Contacts, for the
 * working tenant, and link each contact to its account (the primary
 * `contact_belongs_to_account` relationship). LOCAL DEV ONLY — representative
 * data for fine-tuning the CRM module.
 *
 * Values are generated against the tenant's LIVE field definitions (slugs +
 * select choices read from the DB), so they always match the current schema.
 *
 * Usage: pnpm --filter @adserve/database exec tsx src/seed/generate-demo-data.ts ["Tenant Name"]
 * Defaults to the tenant named "My Organization".
 */

const TENANT_NAME = process.argv[2] ?? "My Organization";
const ACCOUNT_COUNT = Number(process.env.DEMO_ACCOUNTS ?? 100);
const CONTACTS_MIN = 5;
const CONTACTS_MAX = 20;

// ---- tiny PRNG helpers (plain Math.random — this is a one-off node script) ----
const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(a: readonly T[]): T => a[rnd(a.length)];
const chance = (p: number) => Math.random() < p;
const intBetween = (lo: number, hi: number) => lo + rnd(hi - lo + 1);
function pickSome<T>(a: readonly T[], min: number, max: number): T[] {
  const n = intBetween(min, Math.min(max, a.length));
  const pool = [...a];
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(pool.splice(rnd(pool.length), 1)[0]);
  return out;
}

// ---- realistic pools (UK-centric media/advertising flavour) ----
const NAME_ROOTS = [
  "Northstar", "Brightwave", "Meridian", "Cobalt", "Vantage", "Harbourview",
  "Kestrel", "Lumen", "Pinnacle", "Riverside", "Solstice", "Ironclad", "Maple",
  "Beacon", "Quantum", "Verdant", "Atlas", "Orchard", "Sterling", "Tidal",
  "Crowngate", "Halcyon", "Evergreen", "Summit", "Aurora", "Bluestone",
  "Carrick", "Drayton", "Eastgate", "Foxglove", "Granville", "Hawthorne",
  "Kingfisher", "Larchmont", "Montrose", "Nightingale", "Oakhurst", "Pendle",
];
const NAME_SECTORS = [
  "Media", "Marketing", "Communications", "Advertising", "Brands", "Retail",
  "Motors", "Financial", "Foods", "Leisure", "Digital", "Studios", "Ventures",
  "Holdings", "Networks", "Telecom", "Travel", "Insurance", "Property", "Drinks",
];
const NAME_SUFFIX = ["Ltd", "Limited", "Group", "plc", "UK", "& Co", "Partners"];
const AGENCY_NAMES = [
  "MediaCom", "Wavemaker", "OMD", "Mindshare", "Zenith", "Carat", "PHD",
  "the7stars", "Goodstuff", "EssenceMediacom", "Havas Media", "Total Media",
];

const STREETS = [
  "High Street", "Station Road", "Church Lane", "Victoria Road", "King's Road",
  "Market Square", "Mill Lane", "Queen Street", "Park Avenue", "Bridge Street",
  "Albion Way", "Commercial Road", "The Broadway", "Castle Hill", "Granary Wharf",
];
const CITIES: [string, string, string][] = [
  // [city, county, postcode-area]
  ["London", "Greater London", "EC1"], ["Manchester", "Greater Manchester", "M1"],
  ["Birmingham", "West Midlands", "B1"], ["Leeds", "West Yorkshire", "LS1"],
  ["Glasgow", "Lanarkshire", "G1"], ["Edinburgh", "Midlothian", "EH1"],
  ["Bristol", "Avon", "BS1"], ["Liverpool", "Merseyside", "L1"],
  ["Cardiff", "South Glamorgan", "CF10"], ["Sheffield", "South Yorkshire", "S1"],
  ["Nottingham", "Nottinghamshire", "NG1"], ["Brighton", "East Sussex", "BN1"],
  ["Reading", "Berkshire", "RG1"], ["Cambridge", "Cambridgeshire", "CB1"],
  ["Oxford", "Oxfordshire", "OX1"], ["Kingston upon Thames", "Surrey", "KT1"],
  ["Newcastle", "Tyne and Wear", "NE1"], ["Bath", "Somerset", "BA1"],
];
const MALE_FIRST = [
  "Oliver", "Jack", "Harry", "George", "Noah", "Charlie", "Jacob", "Thomas",
  "Oscar", "William", "James", "Henry", "Leo", "Alfie", "Joshua", "Mohammed",
  "Daniel", "Samuel", "Adam", "Ethan",
];
const FEMALE_FIRST = [
  "Amelia", "Olivia", "Isla", "Ava", "Emily", "Sophia", "Grace", "Mia",
  "Poppy", "Ella", "Freya", "Charlotte", "Jessica", "Lily", "Sophie", "Aisha",
  "Hannah", "Chloe", "Ruby", "Maya",
];
const ALL_FIRST = [...MALE_FIRST, ...FEMALE_FIRST];
const LAST_NAMES = [
  "Smith", "Jones", "Taylor", "Brown", "Williams", "Wilson", "Johnson", "Davies",
  "Patel", "Robinson", "Wright", "Thompson", "Evans", "Walker", "White", "Roberts",
  "Green", "Hall", "Wood", "Jackson", "Clarke", "Khan", "Lewis", "Hughes",
  "Edwards", "Murphy", "Cooper", "Ward", "Turner", "Hill", "Shah", "Begum",
];
const JOB_TITLES = [
  "Marketing Director", "Head of Brand", "Media Planner", "Account Manager",
  "Chief Marketing Officer", "Media Buyer", "Brand Manager", "Marketing Manager",
  "Communications Lead", "Digital Marketing Manager", "Head of Media",
  "Campaign Manager", "Procurement Manager", "Finance Director", "Commercial Director",
];
const DEPARTMENTS = [
  "Marketing", "Media", "Brand", "Finance", "Procurement", "Sales",
  "Communications", "Commercial", "Operations",
];
const ACCOUNT_VALUES = [
  "Long-standing client, high retention.",
  "Growth account — expanding spend YoY.",
  "Price-sensitive; reviews agency annually.",
  "Premium brand, values creative quality.",
  "Strategic partner across multiple brands.",
  "New business — onboarded this quarter.",
];

function slugifyDomain(name: string): string {
  const core = name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 22);
  return `${core || "company"}${pick([".co.uk", ".com", ".co.uk"])}`;
}

function ukPostcode(area: string): string {
  return `${area} ${rnd(9)}${pick("ABDEFGHJLNPQRSTUWXYZ")}${pick("ABDEFGHJLNPQRSTUWXYZ")}`.replace(
    /(\w+)(\d\w\w)$/,
    "$1 $2"
  );
}
function ukLandline(): string {
  return `+44 ${pick(["20", "161", "121", "113", "117", "131", "141"])} ${intBetween(
    3000,
    7999
  )} ${intBetween(1000, 9999)}`;
}
function ukMobile(): string {
  return `07${intBetween(100, 999)} ${intBetween(100, 999)}${intBetween(100, 999)}`;
}

interface Address {
  line1: string;
  line2: string;
  city: string;
  county: string;
  postcode: string;
}
function genAddress(): Address {
  const [city, county, area] = pick(CITIES);
  return {
    line1: `${intBetween(1, 240)} ${pick(STREETS)}`,
    line2: chance(0.3) ? `Floor ${intBetween(1, 12)}` : "",
    city,
    county,
    postcode: ukPostcode(area),
  };
}

type FieldDef = { slug: string; fieldType: string; choices: string[] | null; readOnly: boolean };

async function loadFields(tenantId: string, entitySlug: string): Promise<FieldDef[]> {
  const rows = (await db.execute(sql`
    SELECT f.slug, f.field_type AS "fieldType", f.options
    FROM field_definitions f
    JOIN entity_types e ON e.id = f.entity_type_id
    WHERE e.tenant_id = ${tenantId} AND e.slug = ${entitySlug}
      AND f.field_type <> 'relationship'
    ORDER BY f.display_order
  `)) as unknown as {
    slug: string;
    fieldType: string;
    options: { choices?: { value: string }[]; readOnly?: boolean } | null;
  }[];
  return rows.map((r) => ({
    slug: r.slug,
    fieldType: r.fieldType,
    choices: r.options?.choices?.map((c) => c.value) ?? null,
    readOnly: r.options?.readOnly === true,
  }));
}

const money = (amount: number, currency = "GBP") => ({ amount, currency });

function buildAccount(fields: FieldDef[], usedNames: Set<string>) {
  const choices = new Map(fields.map((f) => [f.slug, f.choices]));
  const ch = (slug: string) => choices.get(slug) ?? null;
  const isAgency = chance(0.25);
  let name: string;
  do {
    name = isAgency
      ? `${pick(AGENCY_NAMES)} ${pick(["", "", "London", "UK", "Group"])}`.trim()
      : `${pick(NAME_ROOTS)} ${pick(NAME_SECTORS)} ${pick(NAME_SUFFIX)}`;
  } while (usedNames.has(name.toLowerCase()));
  usedNames.add(name.toLowerCase());

  const domain = slugifyDomain(name);
  const site = genAddress();
  const billingSame = chance(0.8);
  const billing = billingSame ? site : genAddress();
  const currency = ch("billingCurrency") ? pick(["GBP", "GBP", "GBP", "USD", "EUR"]) : "GBP";
  const limit = pick([10000, 25000, 50000, 75000, 100000, 250000, 500000]);

  const all: Record<string, unknown> = {
    name,
    knownAs: name.replace(/\s+(Ltd|Limited|Group|plc|UK|& Co|Partners)$/i, ""),
    accountType: ch("accountType") ? pick(ch("accountType")!) : undefined,
    accountRating: ch("accountRating") ? pick(ch("accountRating")!) : undefined,
    phone: ukLandline(),
    website: `https://www.${domain}`,
    email: `hello@${domain}`,
    industry: ch("industry") ? pick(ch("industry")!) : undefined,
    defaultCategory: ch("defaultCategory") ? pick(ch("defaultCategory")!) : undefined,
    accountOwner: `${pick(ALL_FIRST)} ${pick(LAST_NAMES)}`,
    accountValues: chance(0.6) ? pick(ACCOUNT_VALUES) : undefined,
    description: chance(0.4) ? `${name} — managed media account.` : undefined,
    governmentAccount: chance(0.05),
    poNumbersMandatory: chance(0.35),
    jcnMandatory: chance(0.15),
    noMultipleCampaignsSameBreak: chance(0.2),
    suppressInvoice: chance(0.05),
    creditStatus: ch("creditStatus") ? pick(ch("creditStatus")!) : undefined,
    creditType: ch("creditType") ? pick(ch("creditType")!) : undefined,
    paymentTerms: ch("paymentTerms") ? pick(ch("paymentTerms")!) : undefined,
    vatCode: ch("vatCode") ? pick(ch("vatCode")!) : undefined,
    requiredCreditLimit: money(limit, currency),
    creditLimit: money(limit, currency),
    creditBalance: money(Math.round(limit * Math.random() * 0.6), currency),
    commissionPct: pick([0, 0, 2.5, 10, 12.5, 15]),
    annualRevenue: money(pick([250000, 1000000, 5000000, 12000000, 45000000]), currency),
    employeeCount: pick([8, 25, 60, 150, 400, 1200, 5000]),
    companyRegistrationNumber: String(intBetween(1000000, 13999999)).padStart(8, "0"),
    vatNumber: `GB${intBetween(100000000, 999999999)}`,
    iban: chance(0.3) ? `GB${intBetween(10, 99)}NWBK${intBetween(10000000, 99999999)}${intBetween(10000000, 99999999)}` : undefined,
    billingCurrency: currency,
    status: ch("status") ? (chance(0.9) ? "Active" : pick(ch("status")!)) : undefined,
    accountStationExclusions: ch("accountStationExclusions")
      ? pickSome(ch("accountStationExclusions")!, 0, 2)
      : undefined,
    addressLine1: site.line1,
    addressLine2: site.line2,
    city: site.city,
    stateCounty: site.county,
    postcode: site.postcode,
    country: "United Kingdom",
    billingSameAsSite: billingSame,
    billingAddressLine1: billing.line1,
    billingAddressLine2: billing.line2,
    billingCity: billing.city,
    billingStateCounty: billing.county,
    billingPostcode: billing.postcode,
    billingCountry: "United Kingdom",
  };
  return { name, domain, site, data: filterToFields(all, fields) };
}

function buildContact(fields: FieldDef[], account: { domain: string; site: Address }, used: Set<string>) {
  const choices = new Map(fields.map((f) => [f.slug, f.choices]));
  const ch = (slug: string) => choices.get(slug) ?? null;
  const male = chance(0.5);
  const first = pick(male ? MALE_FIRST : FEMALE_FIRST);
  const last = pick(LAST_NAMES);
  const local = `${first}.${last}`.toLowerCase();
  let email = `${local}@${account.domain}`;
  let n = 2;
  while (used.has(email)) email = `${local}${n++}@${account.domain}`;
  used.add(email);
  const sameAddr = chance(0.7);
  const s = account.site;

  // Gender-consistent salutation, restricted to the tenant's available choices.
  const salPool = male
    ? ["Mr", "Mr", "Mr", "Dr", "Prof", "Mx"]
    : ["Ms", "Mrs", "Miss", "Ms", "Dr", "Prof", "Mx"];
  const salChoices = ch("salutation");
  const salutation = salChoices
    ? (salPool.filter((x) => salChoices.includes(x))[
        rnd(salPool.filter((x) => salChoices.includes(x)).length)
      ] ?? pick(salChoices))
    : undefined;

  const all: Record<string, unknown> = {
    salutation,
    firstName: first,
    lastName: last,
    knownAsName: chance(0.15) ? first : undefined,
    title: pick(JOB_TITLES),
    email,
    emailOther: chance(0.1) ? `${local}@gmail.com` : undefined,
    mobile: ukMobile(),
    phone: chance(0.7) ? ukLandline() : undefined,
    department: pick(DEPARTMENTS),
    billingContact: chance(0.2),
    status: ch("status") ? (chance(0.92) ? "Active" : pick(ch("status")!)) : undefined,
    linkedinUrl: chance(0.5) ? `https://www.linkedin.com/in/${local.replace(/\./g, "-")}` : undefined,
    notes: chance(0.25) ? pick(["Primary day-to-day contact.", "Prefers email over calls.", "Key decision maker.", "Maternity cover until Q3."]) : undefined,
    makeFavourite: chance(0.1),
    sameAsAccountAddress: sameAddr,
    siteAddressLine1: sameAddr ? s.line1 : `${intBetween(1, 240)} ${pick(STREETS)}`,
    siteAddressLine2: sameAddr ? s.line2 : "",
    city: sameAddr ? s.city : pick(CITIES)[0],
    stateCounty: sameAddr ? s.county : pick(CITIES)[1],
    postcode: sameAddr ? s.postcode : ukPostcode(pick(CITIES)[2]),
    country: "United Kingdom",
  };
  return filterToFields(all, fields);
}

/** Keep only keys that are real fields for this entity, dropping undefined. */
function filterToFields(data: Record<string, unknown>, fields: FieldDef[]) {
  const slugs = new Set(fields.map((f) => f.slug));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (slugs.has(k) && v !== undefined) out[k] = v;
  }
  return out;
}

async function run() {
  console.log(`🌱 Generating demo data for tenant "${TENANT_NAME}"…\n`);

  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.name, TENANT_NAME));
  if (!tenant) {
    console.error(`❌ Tenant "${TENANT_NAME}" not found.`);
    await migrationClient.end();
    process.exit(1);
  }

  const ents = await db
    .select({ id: entityTypes.id, slug: entityTypes.slug })
    .from(entityTypes)
    .where(eq(entityTypes.tenantId, tenant.id));
  const accountEntity = ents.find((e) => e.slug === "account");
  const contactEntity = ents.find((e) => e.slug === "contact");
  if (!accountEntity || !contactEntity) {
    console.error("❌ CRM not activated for this tenant (no account/contact entity).");
    await migrationClient.end();
    process.exit(1);
  }

  const [rel] = await db
    .select({ id: schemaRelationships.id })
    .from(schemaRelationships)
    .where(
      and(
        eq(schemaRelationships.tenantId, tenant.id),
        eq(schemaRelationships.name, "contact_belongs_to_account")
      )
    );
  if (!rel) {
    console.error("❌ contact_belongs_to_account relationship not found.");
    await migrationClient.end();
    process.exit(1);
  }

  // Owner/creator: reuse an existing record's creator if present (so "owned"
  // filters work), else null.
  const [ownerRow] = (await db.execute(sql`
    SELECT created_by AS "id" FROM records
    WHERE tenant_id = ${tenant.id} AND created_by IS NOT NULL LIMIT 1
  `)) as unknown as { id: string | null }[];
  const ownerId = ownerRow?.id ?? null;

  const accountFields = await loadFields(tenant.id, "account");
  const contactFields = await loadFields(tenant.id, "contact");

  const usedNames = new Set<string>();
  let totalContacts = 0;

  for (let i = 0; i < ACCOUNT_COUNT; i++) {
    const acc = buildAccount(accountFields, usedNames);
    const [accountRow] = await db
      .insert(records)
      .values({
        tenantId: tenant.id,
        entityTypeId: accountEntity.id,
        data: acc.data,
        createdBy: ownerId,
        updatedBy: ownerId,
        ownedBy: ownerId,
      })
      .returning({ id: records.id });

    const emails = new Set<string>();
    const contactValues = Array.from(
      { length: intBetween(CONTACTS_MIN, CONTACTS_MAX) },
      () => ({
        tenantId: tenant.id,
        entityTypeId: contactEntity.id,
        data: buildContact(contactFields, { domain: acc.domain, site: acc.site }, emails),
        createdBy: ownerId,
        updatedBy: ownerId,
        ownedBy: ownerId,
      })
    );
    const contactRows = await db
      .insert(records)
      .values(contactValues)
      .returning({ id: records.id });

    await db.insert(recordRelationships).values(
      contactRows.map((c) => ({
        tenantId: tenant.id,
        relationshipId: rel.id,
        sourceRecordId: c.id, // contact
        targetRecordId: accountRow.id, // account (primary)
        metadata: {},
      }))
    );
    totalContacts += contactRows.length;
    if ((i + 1) % 20 === 0) console.log(`  …${i + 1}/${ACCOUNT_COUNT} accounts`);
  }

  console.log(
    `\n✅ Created ${ACCOUNT_COUNT} accounts and ${totalContacts} contacts (avg ${(
      totalContacts / ACCOUNT_COUNT
    ).toFixed(1)} per account), all linked.\n`
  );
  await migrationClient.end();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("❌ Generation failed:", err);
  await migrationClient.end().catch(() => {});
  process.exit(1);
});
