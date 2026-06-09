"use client";

import type { SerializedRecord } from "@/lib/crm/serialize";
import { RecordPicker, type RecordSelection } from "./record-picker";

/** The contact's chosen account (existing id or a new name to create). */
export type AccountSelection = RecordSelection;

function accountLabel(rec: SerializedRecord): string {
  const name = rec.data.name;
  if (typeof name === "string" && name.trim() !== "") return name;
  return rec.id;
}

/**
 * Single-select, searchable account control with inline create-new — a thin
 * wrapper over the generic `RecordPicker` configured for accounts (searches the
 * `name` field, allows creating a new account).
 */
export function AccountPicker({
  value,
  onChange,
  disabled,
  inputId,
  invalid,
}: {
  value: AccountSelection | null;
  onChange: (selection: AccountSelection | null) => void;
  disabled?: boolean;
  inputId?: string;
  invalid?: boolean;
}) {
  return (
    <RecordPicker
      value={value}
      onChange={onChange}
      disabled={disabled}
      inputId={inputId}
      invalid={invalid}
      entitySegment="accounts"
      searchFieldSlug="name"
      placeholder="Search accounts…"
      allowCreate
      labelOf={accountLabel}
    />
  );
}
