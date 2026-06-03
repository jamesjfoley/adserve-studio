// @vitest-environment jsdom
import "../setup/jest-dom";

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PrimaryNav, type NavItem } from "@/components/nav/primary-nav";
import { NAV_PINNED_STORAGE_KEY } from "@/components/nav/use-nav-pinned";

const ITEMS: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", iconName: "dashboard" },
  { name: "Accounts", href: "/crm/accounts", iconName: "accounts" },
  { name: "Pipeline", href: "/crm/pipeline", iconName: "pipeline" },
];

function renderNav() {
  return render(<PrimaryNav items={ITEMS} groupLabel="CRM" />);
}

beforeEach(() => {
  delete document.documentElement.dataset.navPinned;
  window.localStorage.clear();
});

afterEach(() => cleanup());

describe("PrimaryNav", () => {
  test("exposes a Primary nav landmark and rail items with accessible names", () => {
    renderNav();
    expect(
      screen.getByRole("navigation", { name: "Primary" })
    ).toBeInTheDocument();
    // Labels stay in the DOM even when the rail collapses (CSS-only hide), so
    // each link keeps its accessible name for assistive tech.
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Accounts" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pipeline" })).toBeInTheDocument();
  });

  test("pin toggle tracks state via aria-pressed and persists on click", () => {
    renderNav(); // default unset -> pinned
    const toggle = screen.getByRole("button", { name: "Pin/Unpin sidebar" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem(NAV_PINNED_STORAGE_KEY)).toBe("false");
  });

  test("advertises the Cmd/Ctrl+B shortcut on the toggle", () => {
    renderNav();
    const toggle = screen.getByRole("button", { name: "Pin/Unpin sidebar" });
    expect(toggle).toHaveAttribute("aria-keyshortcuts", "Meta+B Control+B");
    expect(toggle).toHaveAttribute("title", "Pin/Unpin sidebar (⌘/Ctrl+B)");
  });

  test("Cmd/Ctrl+B toggles the pin state", () => {
    renderNav();
    const toggle = screen.getByRole("button", { name: "Pin/Unpin sidebar" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  test("Cmd/Ctrl+B is suppressed while an editable element is focused (Amendment 2)", () => {
    render(
      <>
        <input data-testid="field" />
        <PrimaryNav items={ITEMS} groupLabel="CRM" />
      </>
    );
    const toggle = screen.getByRole("button", { name: "Pin/Unpin sidebar" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    const field = screen.getByTestId("field") as HTMLInputElement;
    field.focus();
    expect(document.activeElement).toBe(field);

    fireEvent.keyDown(window, { key: "b", metaKey: true });
    // Bold-in-rich-text must win: the nav does not toggle.
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  test("renders accent shortcut links passed via topItems", () => {
    render(
      <PrimaryNav
        items={ITEMS}
        groupLabel="CRM"
        topItems={[
          {
            name: "Super Admin",
            href: "/super-admin",
            iconName: "shield",
            accent: true,
          },
        ]}
      />
    );
    expect(
      screen.getByRole("link", { name: "Super Admin" })
    ).toBeInTheDocument();
  });

  test("mobile drawer trigger opens the off-canvas drawer (closed on load)", () => {
    renderNav();
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // Drawer starts closed.
    expect(
      screen.queryByRole("button", { name: "Close navigation" })
    ).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(
      screen.getByRole("button", { name: "Close navigation" })
    ).toBeInTheDocument();
  });
});
