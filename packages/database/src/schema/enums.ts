import { pgEnum } from "drizzle-orm/pg-core";

export const tenantStatusEnum = pgEnum("tenant_status", [
  "active",
  "suspended",
  "cancelled",
]);

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "invited",
  "disabled",
]);

export const membershipStatusEnum = pgEnum("membership_status", [
  "active",
  "invited",
  "suspended",
]);

export const invitationStatusEnum = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);

export const moduleStatusEnum = pgEnum("module_status", [
  "active",
  "coming_soon",
  "deprecated",
]);

export const fieldTypeEnum = pgEnum("field_type", [
  "text",
  "long_text",
  "number",
  "currency",
  "date",
  "datetime",
  "boolean",
  "select",
  "multi_select",
  "email",
  "phone",
  "url",
  "relationship",
  "user",
  "file",
  "image",
  "json",
  "computed",
  "ai_generated",
]);

export const relationshipTypeEnum = pgEnum("relationship_type", [
  "one_to_one",
  "one_to_many",
  "many_to_one",
  "many_to_many",
]);

export const layoutTypeEnum = pgEnum("layout_type", [
  "detail",
  "list",
  "create",
  "edit",
  "card",
]);

export const validationRuleTypeEnum = pgEnum("validation_rule_type", [
  "field_level",
  "record_level",
  "cross_entity",
]);

export const activityTypeEnum = pgEnum("activity_type", [
  "note",
  "email",
  "call",
  "meeting",
  "task",
  "change",
  "ai_action",
  "system",
]);
