import { NextResponse } from "next/server";
import { FieldDefinitionError, LayoutError } from "@adserve/module-framework";

/**
 * Map the field / layout engine errors to HTTP responses for the Task 1.8
 * tenant-admin config routes. Unknown errors are rethrown (→ 500).
 */
const FIELD_STATUS: Record<FieldDefinitionError["code"], number> = {
  invalid_field_type: 400,
  duplicate_slug: 409,
  not_found: 404,
  system_field: 403,
  has_data: 409,
  type_change_blocked: 422,
};

const LAYOUT_STATUS: Record<LayoutError["code"], number> = {
  not_found: 404,
  last_layout: 409,
  invalid_layout_type: 400,
  invalid_config: 422,
};

export function configErrorResponse(err: unknown): NextResponse {
  if (err instanceof FieldDefinitionError) {
    return NextResponse.json(
      { error: err.message, code: err.code, details: err.details ?? null },
      { status: FIELD_STATUS[err.code] ?? 400 }
    );
  }
  if (err instanceof LayoutError) {
    return NextResponse.json(
      { error: err.message, code: err.code, details: err.details ?? null },
      { status: LAYOUT_STATUS[err.code] ?? 400 }
    );
  }
  throw err;
}
