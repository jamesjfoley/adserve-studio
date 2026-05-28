"use client";

import type { FieldDefinitionWithLabels } from "@adserve/module-framework";
import { BooleanField } from "./fields/BooleanField";
import { CurrencyField } from "./fields/CurrencyField";
import { DateField } from "./fields/DateField";
import { DateTimeField } from "./fields/DateTimeField";
import { EmailField } from "./fields/EmailField";
import type { FieldComponentProps } from "./fields/FieldShell";
import { LongTextField } from "./fields/LongTextField";
import { MultiSelectField } from "./fields/MultiSelectField";
import { NumberField } from "./fields/NumberField";
import { PhoneField } from "./fields/PhoneField";
import { RelationshipField } from "./fields/RelationshipField";
import { SelectField } from "./fields/SelectField";
import { TextField } from "./fields/TextField";
import { UnsupportedField } from "./fields/UnsupportedField";
import { UrlField } from "./fields/UrlField";

/**
 * Single switch from field type → field component. Adding a new field
 * type requires:
 *   1. Schema enum entry in packages/database/src/schema/enums.ts
 *   2. coerceFieldValue case in module-framework/src/field-engine.ts
 *   3. A component file under ./fields/
 *   4. A case in the switch below
 */
export function FieldRenderer(
  props: FieldComponentProps & { field: FieldDefinitionWithLabels }
) {
  switch (props.field.fieldType) {
    case "text":
      return <TextField {...props} />;
    case "long_text":
      return <LongTextField {...props} />;
    case "number":
      return <NumberField {...props} />;
    case "currency":
      return <CurrencyField {...props} />;
    case "date":
      return <DateField {...props} />;
    case "datetime":
      return <DateTimeField {...props} />;
    case "boolean":
      return <BooleanField {...props} />;
    case "select":
      return <SelectField {...props} />;
    case "multi_select":
      return <MultiSelectField {...props} />;
    case "email":
      return <EmailField {...props} />;
    case "phone":
      return <PhoneField {...props} />;
    case "url":
      return <UrlField {...props} />;
    case "relationship":
      return <RelationshipField {...props} />;
    case "user":
    case "file":
    case "image":
    case "json":
    case "computed":
    case "ai_generated":
      return <UnsupportedField {...props} />;
    default: {
      // Exhaustiveness check — TS catches at compile time.
      const _: never = props.field.fieldType;
      void _;
      return <UnsupportedField {...props} />;
    }
  }
}
