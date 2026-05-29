"use client";

import { cn } from "@/lib/utils";
import { formatFieldValue } from "../format-field-value";
import {
  FieldShell,
  inputClassName,
  type FieldComponentProps,
} from "./FieldShell";

const DEFAULT_CURRENCY = "GBP";

// Initial currency dropdown is a small set; tenants who want more can
// add via custom field options.allowedCurrencies. Order matches the
// platform default first.
const CURRENCY_CHOICES = ["GBP", "USD", "EUR", "AUD", "CAD", "JPY"] as const;

interface CurrencyValueShape {
  amount?: number | string;
  currency?: string;
}

function readValue(value: unknown): CurrencyValueShape {
  if (value && typeof value === "object") {
    return value as CurrencyValueShape;
  }
  return {};
}

export function CurrencyField(props: FieldComponentProps) {
  const { field, value, onChange, mode, error, locale, inputId } = props;
  const current = readValue(value);
  const choices =
    (field.options as { allowedCurrencies?: string[] } | undefined)
      ?.allowedCurrencies ?? CURRENCY_CHOICES;

  if (mode === "view") {
    return (
      <FieldShell
        field={field}
        fieldId={inputId}
        error={error}
        locale={locale}
      >
        {formatFieldValue(field, value, locale)}
      </FieldShell>
    );
  }

  const amountStr =
    current.amount === undefined || current.amount === null
      ? ""
      : String(current.amount);
  const currency = current.currency ?? DEFAULT_CURRENCY;

  function setAmount(raw: string) {
    if (raw === "") {
      onChange(null);
      return;
    }
    onChange({ amount: raw, currency });
  }

  function setCurrency(next: string) {
    onChange({ amount: current.amount ?? "", currency: next });
  }

  return (
    <FieldShell
      field={field}
      fieldId={inputId}
      error={error}
      locale={locale}
    >
      <div className="flex gap-2">
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          step="0.01"
          className={cn(inputClassName, "flex-1")}
          value={amountStr}
          required={field.isRequired ?? false}
          aria-required={field.isRequired ?? false}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onChange={(e) => setAmount(e.target.value)}
        />
        <select
          aria-label="Currency code"
          className={cn(inputClassName, "w-24 flex-none")}
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
    </FieldShell>
  );
}
