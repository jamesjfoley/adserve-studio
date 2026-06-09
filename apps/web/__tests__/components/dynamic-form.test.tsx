// @vitest-environment jsdom
import "../setup/jest-dom";

import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  FieldDefinitionWithLabels,
  FieldType,
  LayoutConfig,
} from "@adserve/module-framework";
import { DynamicForm } from "@/components/dynamic-form/DynamicForm";

/**
 * Helper: build a fully-populated FieldDefinitionWithLabels row in one
 * line. Every test field gets a stable id so layout configs can
 * reference them.
 */
function fieldDef(args: {
  id: string;
  slug: string;
  name: string;
  fieldType: FieldType;
  isRequired?: boolean;
  options?: Record<string, unknown>;
  defaultValue?: unknown;
  groupName?: string | null;
  description?: string | null;
}): FieldDefinitionWithLabels {
  return {
    id: args.id,
    tenantId: "00000000-0000-0000-0000-000000000000",
    entityTypeId: "00000000-0000-0000-0000-000000000001",
    name: args.name,
    slug: args.slug,
    fieldType: args.fieldType,
    isRequired: args.isRequired ?? false,
    isUnique: false,
    isSystem: false,
    defaultValue: args.defaultValue ?? null,
    options: args.options ?? {},
    labels: { en: args.name },
    displayOrder: 0,
    groupName: args.groupName ?? null,
    description: args.description ?? null,
    isSearchable: false,
    isFilterable: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function sectionConfig(...specs: { title: string; fieldIds: string[] }[]): LayoutConfig {
  return {
    sections: specs.map((s) => ({
      title: s.title,
      columns: 2 as const,
      fieldIds: s.fieldIds,
    })),
  };
}

describe("DynamicForm — structure", () => {
  test("renders the correct number of sections and fields", () => {
    const name = fieldDef({ id: "f1", slug: "name", name: "Name", fieldType: "text" });
    const email = fieldDef({ id: "f2", slug: "email", name: "Email", fieldType: "email" });
    const notes = fieldDef({ id: "f3", slug: "notes", name: "Notes", fieldType: "long_text" });

    render(
      <DynamicForm
        layoutConfig={sectionConfig(
          { title: "Basic", fieldIds: ["f1", "f2"] },
          { title: "Detail", fieldIds: ["f3"] }
        )}
        fields={[name, email, notes]}
        initialData={null}
        mode="create"
      />
    );

    // Section headings
    expect(screen.getByRole("heading", { name: "Basic" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Detail" })).toBeInTheDocument();

    // One control per field. Email maps to type="email", text to type="text",
    // long_text to a textarea.
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toBeInTheDocument();
  });
});

describe("DynamicForm — smoke across all field types", () => {
  test("every supported field type renders without crashing", () => {
    const types: Array<{ id: string; slug: string; name: string; fieldType: FieldType; options?: Record<string, unknown> }> = [
      { id: "t1", slug: "f_text", name: "Text", fieldType: "text" },
      { id: "t2", slug: "f_long", name: "Long text", fieldType: "long_text" },
      { id: "t3", slug: "f_num", name: "Number", fieldType: "number" },
      { id: "t4", slug: "f_cur", name: "Currency", fieldType: "currency" },
      { id: "t5", slug: "f_date", name: "Date", fieldType: "date" },
      { id: "t6", slug: "f_dt", name: "Datetime", fieldType: "datetime" },
      { id: "t7", slug: "f_bool", name: "Boolean", fieldType: "boolean" },
      {
        id: "t8",
        slug: "f_sel",
        name: "Select",
        fieldType: "select",
        options: { choices: [{ value: "a", label: "A" }] },
      },
      {
        id: "t9",
        slug: "f_msel",
        name: "Multi select",
        fieldType: "multi_select",
        options: { choices: [{ value: "x", label: "X" }] },
      },
      { id: "t10", slug: "f_email", name: "Email", fieldType: "email" },
      { id: "t11", slug: "f_phone", name: "Phone", fieldType: "phone" },
      { id: "t12", slug: "f_url", name: "URL", fieldType: "url" },
      { id: "t13", slug: "f_rel", name: "Relationship", fieldType: "relationship" },
    ];
    const fields = types.map((t) => fieldDef(t));

    render(
      <DynamicForm
        layoutConfig={sectionConfig({
          title: "All",
          fieldIds: types.map((t) => t.id),
        })}
        fields={fields}
        initialData={null}
        mode="create"
      />
    );

    // One label per field type — proves each component mounted.
    // Exact text match (not regex) so "Currency" doesn't also match
    // the currency-picker select's aria-label ("Currency code").
    for (const t of types) {
      expect(screen.getByLabelText(t.name)).toBeInTheDocument();
    }
  });

  test("unsupported field type renders a fallback placeholder", () => {
    const unsupported = fieldDef({
      id: "u1",
      slug: "computed_thing",
      name: "Computed",
      fieldType: "computed",
    });
    render(
      <DynamicForm
        layoutConfig={sectionConfig({ title: "Misc", fieldIds: ["u1"] })}
        fields={[unsupported]}
        initialData={null}
        mode="view"
      />
    );
    expect(screen.getByText(/not yet supported/i)).toBeInTheDocument();
  });
});

describe("DynamicForm — validation", () => {
  test("required field shows inline error on empty submit and onSubmit is not called", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const required = fieldDef({
      id: "r1",
      slug: "name",
      name: "Name",
      fieldType: "text",
      isRequired: true,
    });

    render(
      <DynamicForm
        layoutConfig={sectionConfig({ title: "Basic", fieldIds: ["r1"] })}
        fields={[required]}
        initialData={null}
        mode="create"
        onSubmit={onSubmit}
      />
    );

    await user.click(screen.getByRole("button", { name: /create/i }));

    // Error rendered inline
    expect(screen.getByRole("alert")).toHaveTextContent(/required/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("submit calls onSubmit with coerced data when valid", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const name = fieldDef({ id: "f1", slug: "name", name: "Name", fieldType: "text" });
    const age = fieldDef({ id: "f2", slug: "age", name: "Age", fieldType: "number" });

    render(
      <DynamicForm
        layoutConfig={sectionConfig({
          title: "Basic",
          fieldIds: ["f1", "f2"],
        })}
        fields={[name, age]}
        initialData={null}
        mode="create"
        onSubmit={onSubmit}
      />
    );

    await user.type(screen.getByLabelText("Name"), "Alice");
    await user.type(screen.getByLabelText("Age"), "42");
    await user.click(screen.getByRole("button", { name: /create/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ name: "Alice", age: 42 });
  });

  test("required marker rendered next to required-field labels", () => {
    const required = fieldDef({
      id: "r1",
      slug: "name",
      name: "Name",
      fieldType: "text",
      isRequired: true,
    });
    render(
      <DynamicForm
        layoutConfig={sectionConfig({ title: "B", fieldIds: ["r1"] })}
        fields={[required]}
        initialData={null}
        mode="create"
      />
    );
    // Visual marker present (aria-hidden so it doesn't pollute the
    // input's accessible name).
    expect(screen.getByTestId("required-marker")).toBeInTheDocument();
    // aria-required is the source of truth for assistive tech.
    expect(screen.getByLabelText("Name")).toHaveAttribute(
      "aria-required",
      "true"
    );
  });
});

describe("DynamicForm — view mode", () => {
  test("renders values as read-only text, not inputs", () => {
    const name = fieldDef({ id: "f1", slug: "name", name: "Name", fieldType: "text" });
    const notes = fieldDef({ id: "f2", slug: "notes", name: "Notes", fieldType: "long_text" });
    const status = fieldDef({
      id: "f3",
      slug: "status",
      name: "Status",
      fieldType: "select",
      options: {
        choices: [{ value: "active", label: "Active" }],
      },
    });

    render(
      <DynamicForm
        layoutConfig={sectionConfig({
          title: "Basic",
          fieldIds: ["f1", "f2", "f3"],
        })}
        fields={[name, notes, status]}
        initialData={{ name: "Acme", notes: "Important", status: "active" }}
        mode="view"
      />
    );

    // No input/textarea/select elements in view mode
    expect(document.querySelectorAll("input").length).toBe(0);
    expect(document.querySelectorAll("textarea").length).toBe(0);
    expect(document.querySelectorAll("select").length).toBe(0);

    // Values appear as text
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Important")).toBeInTheDocument();
    // Select shows the resolved label, not the raw value
    expect(screen.getByText("Active")).toBeInTheDocument();

    // No submit button either
    expect(
      screen.queryByRole("button", { name: /save|create/i })
    ).not.toBeInTheDocument();
  });

  test("currency view formats with explicit locale + currency code", () => {
    const amount = fieldDef({
      id: "c1",
      slug: "annualRevenue",
      name: "Annual revenue",
      fieldType: "currency",
    });

    render(
      <DynamicForm
        layoutConfig={sectionConfig({
          title: "Financials",
          fieldIds: ["c1"],
        })}
        fields={[amount]}
        initialData={{ annualRevenue: { amount: 50000, currency: "GBP" } }}
        mode="view"
        locale="en-GB"
      />
    );

    // Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" })
    // produces "£50,000.00". The component is locked to the locale we
    // pass in, so this assertion is deterministic regardless of the
    // Node default locale.
    const expected = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: 2,
    }).format(50000);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  // Split into three separate tests rather than using rerender, because
  // DynamicForm initializes form state via useState's lazy initializer
  // — rerender with new initialData would not change the displayed
  // value (the initializer only runs on first mount).
  test("boolean view renders Yes when flag is true", () => {
    const f = fieldDef({ id: "b1", slug: "flag", name: "Flag", fieldType: "boolean" });
    render(
      <DynamicForm
        layoutConfig={sectionConfig({ title: "B", fieldIds: ["b1"] })}
        fields={[f]}
        initialData={{ flag: true }}
        mode="view"
      />
    );
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });

  test("boolean view renders No when flag is false", () => {
    const f = fieldDef({ id: "b1", slug: "flag", name: "Flag", fieldType: "boolean" });
    render(
      <DynamicForm
        layoutConfig={sectionConfig({ title: "B", fieldIds: ["b1"] })}
        fields={[f]}
        initialData={{ flag: false }}
        mode="view"
      />
    );
    expect(screen.getByText("No")).toBeInTheDocument();
  });

  test("boolean view renders em-dash when flag is null", () => {
    const f = fieldDef({ id: "b1", slug: "flag", name: "Flag", fieldType: "boolean" });
    render(
      <DynamicForm
        layoutConfig={sectionConfig({ title: "B", fieldIds: ["b1"] })}
        fields={[f]}
        initialData={{ flag: null }}
        mode="view"
      />
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("DynamicForm — initial state", () => {
  test("edit mode pre-populates from initialData", () => {
    const name = fieldDef({ id: "f1", slug: "name", name: "Name", fieldType: "text" });
    render(
      <DynamicForm
        layoutConfig={sectionConfig({ title: "B", fieldIds: ["f1"] })}
        fields={[name]}
        initialData={{ name: "Existing" }}
        mode="edit"
      />
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Existing");
  });

  test("create mode initializes from field defaultValue", () => {
    const status = fieldDef({
      id: "f1",
      slug: "status",
      name: "Status",
      fieldType: "select",
      defaultValue: "prospect",
      options: {
        choices: [
          { value: "active", label: "Active" },
          { value: "prospect", label: "Prospect" },
        ],
      },
    });

    render(
      <DynamicForm
        layoutConfig={sectionConfig({ title: "B", fieldIds: ["f1"] })}
        fields={[status]}
        initialData={null}
        mode="create"
      />
    );

    expect(screen.getByLabelText("Status")).toHaveValue("prospect");
  });
});

describe("DynamicForm — localization", () => {
  test("resolves labels through the localized labels map", () => {
    const name: FieldDefinitionWithLabels = {
      ...fieldDef({ id: "f1", slug: "name", name: "Name", fieldType: "text" }),
      labels: { en: "Name", fr: "Nom" },
    };
    render(
      <DynamicForm
        layoutConfig={sectionConfig({ title: "B", fieldIds: ["f1"] })}
        fields={[name]}
        initialData={null}
        mode="create"
        locale="fr"
      />
    );
    expect(screen.getByLabelText("Nom")).toBeInTheDocument();
  });

  test("falls back to en when the requested locale is missing", () => {
    const name: FieldDefinitionWithLabels = {
      ...fieldDef({ id: "f1", slug: "name", name: "Name", fieldType: "text" }),
      labels: { en: "Name" },
    };
    render(
      <DynamicForm
        layoutConfig={sectionConfig({ title: "B", fieldIds: ["f1"] })}
        fields={[name]}
        initialData={null}
        mode="create"
        locale="ja"
      />
    );
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });
});

describe("DynamicForm — inactive (read-only) fields", () => {
  test("a disabledWhen field is read-only when its condition holds", () => {
    const toggle = fieldDef({
      id: "t",
      slug: "toggle",
      name: "Toggle",
      fieldType: "boolean",
    });
    const dep = fieldDef({
      id: "d",
      slug: "dep",
      name: "Dependent",
      fieldType: "text",
      options: { disabledWhen: { field: "toggle", equals: true } },
    });

    render(
      <DynamicForm
        layoutConfig={sectionConfig({ title: "S", fieldIds: ["t", "d"] })}
        fields={[toggle, dep]}
        initialData={{ toggle: true, dep: "Inherited" }}
        mode="edit"
      />
    );

    // Condition holds → no editable control for the dependent field; its value
    // shows read-only instead.
    expect(screen.queryByLabelText("Dependent")).not.toBeInTheDocument();
    expect(screen.getByText("Inherited")).toBeInTheDocument();
  });

  test("a disabledWhen field is editable when its condition does not hold", () => {
    const toggle = fieldDef({
      id: "t",
      slug: "toggle",
      name: "Toggle",
      fieldType: "boolean",
    });
    const dep = fieldDef({
      id: "d",
      slug: "dep",
      name: "Dependent",
      fieldType: "text",
      options: { disabledWhen: { field: "toggle", equals: true } },
    });

    render(
      <DynamicForm
        layoutConfig={sectionConfig({ title: "S", fieldIds: ["t", "d"] })}
        fields={[toggle, dep]}
        initialData={{ toggle: false, dep: "Editable" }}
        mode="edit"
      />
    );

    expect(screen.getByLabelText("Dependent")).toBeInTheDocument();
  });

  test("a readOnly field is always inactive", () => {
    const locked = fieldDef({
      id: "r",
      slug: "locked",
      name: "Locked",
      fieldType: "text",
      options: { readOnly: true },
    });

    render(
      <DynamicForm
        layoutConfig={sectionConfig({ title: "S", fieldIds: ["r"] })}
        fields={[locked]}
        initialData={{ locked: "Fixed" }}
        mode="edit"
      />
    );

    expect(screen.queryByLabelText("Locked")).not.toBeInTheDocument();
    expect(screen.getByText("Fixed")).toBeInTheDocument();
  });
});
