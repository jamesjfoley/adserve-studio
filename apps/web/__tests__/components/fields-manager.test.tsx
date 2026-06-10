// @vitest-environment jsdom
import "../setup/jest-dom";

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FieldsManager } from "@/app/(tenant-admin)/admin/crm/fields/_components/fields-manager";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mockOk() {
  return vi
    .spyOn(global, "fetch")
    .mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }) as Response
    );
}

function lastBody(fetchMock: ReturnType<typeof vi.spyOn>) {
  const call = fetchMock.mock.calls.at(-1)!;
  return JSON.parse((call[1] as RequestInit).body as string) as Record<
    string,
    unknown
  >;
}

describe("FieldsManager — select options (single field, sortable)", () => {
  test("each line is one option (value === label), saved in entered order", async () => {
    const fetchMock = mockOk();
    const user = userEvent.setup();
    render(<FieldsManager entityType="account" fields={[]} />);

    await user.click(screen.getByText("+ Add field"));
    await user.selectOptions(screen.getByDisplayValue("text"), "select");

    const textarea = screen.getByLabelText("Options (one per line)");
    await user.type(textarea, "gold\nsilver\nbronze");
    await user.click(screen.getByRole("button", { name: "Add field" }));

    const body = lastBody(fetchMock);
    expect(body.options).toEqual({
      choices: [
        { value: "gold", label: "gold" },
        { value: "silver", label: "silver" },
        { value: "bronze", label: "bronze" },
      ],
      sortAlphabetical: false,
    });
    fetchMock.mockRestore();
  });

  test("the alphabetical checkbox sorts the saved choices A→Z", async () => {
    const fetchMock = mockOk();
    const user = userEvent.setup();
    render(<FieldsManager entityType="account" fields={[]} />);

    await user.click(screen.getByText("+ Add field"));
    await user.selectOptions(screen.getByDisplayValue("text"), "select");
    await user.type(
      screen.getByLabelText("Options (one per line)"),
      "silver\ngold\nbronze"
    );
    await user.click(screen.getByLabelText(/sort alphabetically/i));
    await user.click(screen.getByRole("button", { name: "Add field" }));

    const body = lastBody(fetchMock);
    expect(body.options).toEqual({
      choices: [
        { value: "bronze", label: "bronze" },
        { value: "gold", label: "gold" },
        { value: "silver", label: "silver" },
      ],
      sortAlphabetical: true,
    });
    fetchMock.mockRestore();
  });

  test("blank lines and duplicates are dropped", async () => {
    const fetchMock = mockOk();
    const user = userEvent.setup();
    render(<FieldsManager entityType="account" fields={[]} />);

    await user.click(screen.getByText("+ Add field"));
    await user.selectOptions(screen.getByDisplayValue("text"), "select");
    await user.type(
      screen.getByLabelText("Options (one per line)"),
      "gold\n\n  gold  \nsilver\n"
    );
    await user.click(screen.getByRole("button", { name: "Add field" }));

    const body = lastBody(fetchMock) as { options: { choices: unknown[] } };
    expect(body.options.choices).toEqual([
      { value: "gold", label: "gold" },
      { value: "silver", label: "silver" },
    ]);
    fetchMock.mockRestore();
  });

  test("any field can be renamed — including a system field — via name + labels.en", async () => {
    const fetchMock = mockOk();
    const user = userEvent.setup();
    render(
      <FieldsManager
        entityType="account"
        fields={[
          {
            id: "fsys",
            name: "Account status",
            slug: "status",
            fieldType: "select",
            isRequired: false,
            isFilterable: true,
            isSystem: true, // system field — rename must still be offered
            description: "",
            options: { choices: [{ value: "Active", label: "Active" }] },
          },
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Rename" }));
    const inputEl = screen.getByLabelText("Rename Account status");
    await user.clear(inputEl);
    await user.type(inputEl, "Lifecycle stage");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const call = fetchMock.mock.calls.at(-1)!;
    expect(call[0]).toBe("/api/admin/crm/fields/fsys");
    expect((call[1] as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((call[1] as RequestInit).body as string);
    // Slug is untouched; name + display label both update.
    expect(body).toEqual({ name: "Lifecycle stage", labels: { en: "Lifecycle stage" } });
    expect(body.slug).toBeUndefined();
    fetchMock.mockRestore();
  });

  test("editing an existing select pre-fills the textarea and sort flag", async () => {
    const fetchMock = mockOk();
    const user = userEvent.setup();
    render(
      <FieldsManager
        entityType="account"
        fields={[
          {
            id: "fr",
            name: "Account Rating",
            slug: "account_rating",
            fieldType: "select",
            isRequired: false,
            isFilterable: false,
            isSystem: false,
            description: "",
            options: {
              choices: [
                { value: "bronze", label: "bronze" },
                { value: "gold", label: "gold" },
              ],
              sortAlphabetical: true,
            },
          },
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Options" }));
    const textarea = screen.getByLabelText(
      "Options (one per line)"
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("bronze\ngold");
    expect(screen.getByLabelText(/sort alphabetically/i)).toBeChecked();

    // Append a new option; alpha sort keeps the saved order A→Z.
    await user.type(textarea, "\nsilver");
    await user.click(screen.getByRole("button", { name: "Save options" }));

    const body = lastBody(fetchMock) as {
      options: { choices: unknown[]; sortAlphabetical: boolean };
    };
    expect(body.options.choices).toEqual([
      { value: "bronze", label: "bronze" },
      { value: "gold", label: "gold" },
      { value: "silver", label: "silver" },
    ]);
    expect(body.options.sortAlphabetical).toBe(true);
    fetchMock.mockRestore();
  });
});
