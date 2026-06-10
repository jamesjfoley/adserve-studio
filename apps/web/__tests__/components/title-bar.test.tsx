// @vitest-environment jsdom
import "../setup/jest-dom";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signOut = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs", () => ({ useClerk: () => ({ signOut }) }));

import { TitleBar } from "@/components/shell/title-bar";
import type { ShellModule } from "@/lib/shell";

const MODULES: ShellModule[] = [
  { slug: "crm", name: "CRM", href: "/dashboard", available: true },
  { slug: "campaigns", name: "Campaign planning", href: null, available: false },
];

function renderBar(overrides: Partial<Parameters<typeof TitleBar>[0]> = {}) {
  return render(
    <TitleBar
      modules={MODULES}
      logoUrl={null}
      moduleName="CRM"
      initials="AA"
      userName="Alice Anderson"
      version="0.1.0"
      defaultMode="always"
      {...overrides}
    />
  );
}

afterEach(() => {
  window.localStorage.clear();
  cleanup();
});

describe("TitleBar", () => {
  test("shows the active module name + user initials roundel", () => {
    renderBar();
    expect(screen.getByText("CRM")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "User menu" })).toHaveTextContent("AA");
    cleanup();
  });

  test("candy box lists available modules as links and coming-soon as disabled", async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole("button", { name: "Switch module" }));
    // Available module → link to its home.
    expect(screen.getByRole("link", { name: "CRM" })).toHaveAttribute("href", "/dashboard");
    // Coming-soon module shown but not a link.
    expect(screen.getByText("Campaign planning")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Campaign planning" })).not.toBeInTheDocument();
    cleanup();
  });

  test("user menu logs out via Clerk", async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole("button", { name: "User menu" }));
    expect(screen.getByText("Version 0.1.0")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(signOut).toHaveBeenCalledWith({ redirectUrl: "/sign-in" });
    cleanup();
  });

  test("renders a custom logo when provided", () => {
    renderBar({ logoUrl: "data:image/png;base64,AAA" });
    expect(screen.getByAltText("Company logo")).toHaveAttribute(
      "src",
      "data:image/png;base64,AAA"
    );
    cleanup();
  });

  test("the lock toggle flips the user's mode (locked ↔ floating)", async () => {
    const user = userEvent.setup();
    renderBar({ defaultMode: "always", storageScope: "user-1" });
    // Starts locked → the control offers to unlock (auto-hide).
    const unlock = screen.getByRole("button", {
      name: /unlock title bar/i,
    });
    expect(unlock).toHaveAttribute("aria-pressed", "true");
    await user.click(unlock);
    // Now floating → the control offers to lock (keep visible).
    expect(
      screen.getByRole("button", { name: /lock title bar/i })
    ).toHaveAttribute("aria-pressed", "false");
    cleanup();
  });

  test("the chosen mode persists per user across remounts", async () => {
    const user = userEvent.setup();
    const { unmount } = renderBar({ defaultMode: "always", storageScope: "user-1" });
    await user.click(screen.getByRole("button", { name: /unlock title bar/i }));
    unmount();

    // Fresh mount for the same user restores the floating choice…
    renderBar({ defaultMode: "always", storageScope: "user-1" });
    expect(
      await screen.findByRole("button", { name: /lock title bar/i })
    ).toBeInTheDocument();
    cleanup();

    // …while a different user falls back to the admin default (locked).
    renderBar({ defaultMode: "always", storageScope: "user-2" });
    expect(
      await screen.findByRole("button", { name: /unlock title bar/i })
    ).toBeInTheDocument();
    cleanup();
  });
});
