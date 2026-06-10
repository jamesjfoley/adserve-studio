// @vitest-environment jsdom
import "../setup/jest-dom";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CollapsiblePanel } from "@/components/ui/collapsible-panel";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(
  __dirname,
  "../../src/components/ui/collapsible-panel.tsx"
);

afterEach(() => cleanup());

describe("CollapsiblePanel", () => {
  test("non-collapsible: renders body, no toggle button", () => {
    render(
      <CollapsiblePanel title="Static">
        <p>Body content</p>
      </CollapsiblePanel>
    );
    expect(screen.getByText("Body content")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("collapsible: open by default, toggle hides then shows the body", async () => {
    const user = userEvent.setup();
    render(
      <CollapsiblePanel title="Details" collapsible>
        <p>Body content</p>
      </CollapsiblePanel>
    );

    const toggle = screen.getByRole("button", { name: /details/i });
    // Open by default
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Body content")).toBeInTheDocument();

    // Close
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Body content")).not.toBeInTheDocument();
    // Header band stays visible.
    expect(screen.getByRole("heading", { name: "Details" })).toBeInTheDocument();

    // Re-open
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });

  test("collapsible: defaultOpen=false starts collapsed", () => {
    render(
      <CollapsiblePanel title="Details" collapsible defaultOpen={false}>
        <p>Body content</p>
      </CollapsiblePanel>
    );
    expect(screen.getByRole("button", { name: /details/i })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(screen.queryByText("Body content")).not.toBeInTheDocument();
  });

  test("toggle button is wired to the body via aria-controls", () => {
    render(
      <CollapsiblePanel title="Details" collapsible>
        <p>Body content</p>
      </CollapsiblePanel>
    );
    const toggle = screen.getByRole("button", { name: /details/i });
    const controls = toggle.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    const body = document.getElementById(controls as string);
    expect(body).not.toBeNull();
    expect(body).toHaveTextContent("Body content");
  });

  test("token-driven surface styling on the root (no raw hex)", () => {
    const { container } = render(
      <CollapsiblePanel title="x" collapsible>
        body
      </CollapsiblePanel>
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("adserve-panel");
    expect(root.style.borderRadius).toBe("var(--radius-panel)");
    expect(root.style.backgroundColor).toBe("var(--panel-bg)");
    const source = readFileSync(SOURCE, "utf8");
    // No raw hex colours in the wrapper.
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  test("source imports no server-only module", () => {
    const source = readFileSync(SOURCE, "utf8");
    expect(source).not.toMatch(/from\s+["']postgres["']/);
    expect(source).not.toMatch(/from\s+["']@adserve\/database["']/);
  });
});
