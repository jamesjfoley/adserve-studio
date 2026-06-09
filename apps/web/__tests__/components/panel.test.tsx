// @vitest-environment jsdom
import "../setup/jest-dom";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Panel } from "@/components/ui/panel";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PANEL_SOURCE = path.resolve(
  __dirname,
  "../../src/components/ui/panel.tsx"
);

afterEach(() => cleanup());

describe("Panel", () => {
  test("renders its children", () => {
    render(
      <Panel>
        <p>Body content</p>
      </Panel>
    );
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });

  test("renders title and actions in a header row when provided", () => {
    render(
      <Panel title="Pipeline" actions={<button type="button">Add</button>}>
        <p>Body</p>
      </Panel>
    );
    const heading = screen.getByRole("heading", { name: "Pipeline" });
    expect(heading).toBeInTheDocument();
    // Title uses the established heading style so refactored panels match today.
    expect(heading).toHaveClass("text-sm", "font-semibold", "tracking-tight");
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  test("renders no header (no heading) when neither title nor actions given", () => {
    render(
      <Panel>
        <p>Just body</p>
      </Panel>
    );
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByText("Just body")).toBeInTheDocument();
  });

  test("applies token-based surface styling on the root", () => {
    const { container } = render(<Panel>x</Panel>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe("SECTION");
    expect(root).toHaveClass("adserve-panel");
    // Radius / border / background are driven by tokens on the root; the body
    // wrapper carries the panel padding.
    expect(root.style.borderRadius).toBe("var(--radius-panel)");
    expect(root.style.borderColor).toBe("var(--panel-border)");
    expect(root.style.backgroundColor).toBe("var(--panel-bg)");
    const body = root.lastElementChild as HTMLElement;
    expect(body.style.padding).toBe("var(--panel-padding)");
  });

  test("default elevation is 1; explicit elevation changes the box-shadow token", () => {
    const { container: a } = render(<Panel>a</Panel>);
    const defaultRoot = a.firstElementChild as HTMLElement;
    expect(defaultRoot.style.boxShadow).toBe("var(--elevation-1)");

    const { container: b } = render(<Panel elevation={3}>b</Panel>);
    const elevatedRoot = b.firstElementChild as HTMLElement;
    expect(elevatedRoot.style.boxShadow).toBe("var(--elevation-3)");

    const { container: c } = render(<Panel elevation={0}>c</Panel>);
    const flatRoot = c.firstElementChild as HTMLElement;
    expect(flatRoot.style.boxShadow).toBe("var(--elevation-0)");
  });

  test("compact uses the compact padding token", () => {
    const { container } = render(<Panel compact>x</Panel>);
    const root = container.firstElementChild as HTMLElement;
    const body = root.lastElementChild as HTMLElement;
    expect(body.style.padding).toBe("var(--panel-padding-sm)");
  });

  test("as='div' renders a div; default renders a section", () => {
    const { container: d } = render(<Panel as="div">x</Panel>);
    expect((d.firstElementChild as HTMLElement).tagName).toBe("DIV");

    const { container: s } = render(<Panel>x</Panel>);
    expect((s.firstElementChild as HTMLElement).tagName).toBe("SECTION");
  });

  test("forwards className and aria-label onto the root", () => {
    const { container } = render(
      <Panel className="lg:col-span-2" aria-label="Linked contacts">
        x
      </Panel>
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("lg:col-span-2");
    expect(root).toHaveAttribute("aria-label", "Linked contacts");
  });

  // Locked criterion #17 — fast in-suite guard complementing the lint gate.
  test("source imports no server-only module", () => {
    const source = readFileSync(PANEL_SOURCE, "utf8");
    expect(source).not.toMatch(/from\s+["']postgres["']/);
    expect(source).not.toMatch(/from\s+["']@adserve\/database["']/);
  });
});
