/**
 * Setup file for component tests. Extends vitest's `expect` with
 * @testing-library/jest-dom matchers (toBeInTheDocument, toHaveValue,
 * toBeRequired, etc.) and wires up DOM cleanup between tests.
 *
 * Component test files opt in by:
 *   1. Top-of-file directive: `// @vitest-environment jsdom`
 *   2. Importing this file at the top (`import "../setup/jest-dom"`).
 *
 * @testing-library/react's auto-cleanup relies on `globals` being on
 * (afterEach as a free function). We run with `globals: false`, so we
 * wire cleanup explicitly here.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
