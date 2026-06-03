import type { ReactNode } from "react";
import type { FieldDefinitionWithLabels } from "@adserve/module-framework";
import { cn } from "@/lib/utils";
import { viewValueClassName, VIEW_EMPTY } from "./fields/FieldShell";

/**
 * Single source of truth for rendering a field's *value* in read-only
 * (view) mode. Both the dynamic form's field components and the dynamic
 * table's cells call this, so a record looks identical wherever it is
 * surfaced.
 *
 * This is value-only — the field *label* is resolved separately via
 * `resolveLabel` (form: FieldShell; table: column header). The returned
 * node is intentionally **un-truncated**: callers that need to clamp
 * (e.g. table cells with long_text) apply CSS line-clamp to a wrapper,
 * which never changes textContent and keeps the consistency guarantee.
 *
 * Locale handling mirrors each field component exactly — Intl calls fall
 * back to "en-GB" when no locale is passed — so extracting this function
 * is behaviour-preserving for the form.
 */

const DEFAULT_LOCALE = "en-GB";
const DEFAULT_CURRENCY = "GBP";

interface Choice {
  value: string;
  label: string;
}

interface CurrencyValueShape {
  amount?: number | string;
  currency?: string;
}

function readChoices(field: Pick<FieldDefinitionWithLabels, "options">): Choice[] {
  const opts = (field.options as { choices?: Choice[] }) ?? {};
  return Array.isArray(opts.choices) ? opts.choices : [];
}

function readCurrency(value: unknown): CurrencyValueShape {
  if (value && typeof value === "object") {
    return value as CurrencyValueShape;
  }
  return {};
}

function readArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

export function formatFieldValue(
  field: Pick<FieldDefinitionWithLabels, "fieldType" | "options">,
  value: unknown,
  locale?: string
): ReactNode {
  const loc = locale ?? DEFAULT_LOCALE;

  switch (field.fieldType) {
    case "text":
    case "phone": {
      const str = value === null || value === undefined ? "" : String(value);
      return <p className={viewValueClassName}>{str || VIEW_EMPTY}</p>;
    }

    case "long_text": {
      const str = value === null || value === undefined ? "" : String(value);
      return (
        <p className={cn(viewValueClassName, "whitespace-pre-wrap")}>
          {str || VIEW_EMPTY}
        </p>
      );
    }

    case "number": {
      return (
        <p className={viewValueClassName}>
          {value === null || value === undefined
            ? VIEW_EMPTY
            : new Intl.NumberFormat(loc).format(Number(value))}
        </p>
      );
    }

    case "currency": {
      const current = readCurrency(value);
      const formatted =
        current.amount === undefined ||
        current.amount === null ||
        current.amount === ""
          ? VIEW_EMPTY
          : new Intl.NumberFormat(loc, {
              style: "currency",
              currency: current.currency ?? DEFAULT_CURRENCY,
              maximumFractionDigits: 2,
            }).format(Number(current.amount));
      return <p className={viewValueClassName}>{formatted}</p>;
    }

    case "date": {
      const str = value === null || value === undefined ? "" : String(value);
      let display: string = VIEW_EMPTY;
      if (str) {
        const d = new Date(str + "T00:00:00Z");
        display = Number.isNaN(d.getTime())
          ? str
          : new Intl.DateTimeFormat(loc, {
              dateStyle: "medium",
              timeZone: "UTC",
            }).format(d);
      }
      return <p className={viewValueClassName}>{display}</p>;
    }

    case "datetime": {
      const str = value === null || value === undefined ? "" : String(value);
      let display: string = VIEW_EMPTY;
      if (str) {
        const d = new Date(str);
        display = Number.isNaN(d.getTime())
          ? str
          : new Intl.DateTimeFormat(loc, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(d);
      }
      return <p className={viewValueClassName}>{display}</p>;
    }

    case "boolean": {
      const display =
        value === null || value === undefined
          ? VIEW_EMPTY
          : value === true ||
              value === "true" ||
              (typeof value === "string" && value.toLowerCase() === "true")
            ? "Yes"
            : "No";
      return <p className={viewValueClassName}>{display}</p>;
    }

    case "select": {
      const choices = readChoices(field);
      const str = value === null || value === undefined ? "" : String(value);
      const choice = choices.find((c) => c.value === str);
      return (
        <p className={viewValueClassName}>
          {str ? (choice?.label ?? str) : VIEW_EMPTY}
        </p>
      );
    }

    case "multi_select": {
      const choices = readChoices(field);
      const selected = readArray(value);
      const labels = selected
        .map((v) => choices.find((c) => c.value === v)?.label ?? v)
        .join(", ");
      return <p className={viewValueClassName}>{labels || VIEW_EMPTY}</p>;
    }

    case "email": {
      const str = value === null || value === undefined ? "" : String(value);
      return str ? (
        <a
          href={`mailto:${str}`}
          className="text-sm text-[var(--accent)] hover:underline"
        >
          {str}
        </a>
      ) : (
        <p className={viewValueClassName}>{VIEW_EMPTY}</p>
      );
    }

    case "url": {
      const str = value === null || value === undefined ? "" : String(value);
      return str ? (
        <a
          href={str}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate text-sm text-[var(--accent)] hover:underline"
        >
          {str}
        </a>
      ) : (
        <p className={viewValueClassName}>{VIEW_EMPTY}</p>
      );
    }

    case "relationship": {
      const str = value === null || value === undefined ? "" : String(value);
      return (
        <p className={cn(viewValueClassName, "font-mono text-xs")}>
          {str || VIEW_EMPTY}
        </p>
      );
    }

    default: {
      // user / file / image / json / computed / ai_generated — no
      // dedicated view formatting yet. Render raw (or em-dash) so a
      // misconfigured column never crashes the table.
      return (
        <p className={viewValueClassName}>
          {value === null || value === undefined ? VIEW_EMPTY : String(value)}
        </p>
      );
    }
  }
}
