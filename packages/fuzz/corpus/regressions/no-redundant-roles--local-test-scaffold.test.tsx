// rule: no-redundant-roles
// weakness: test-gating
// source: PR #1304

import { vi } from "vitest";

vi.mock("navigation-link", () => ({
  default: () => <button role="button">Open</button>,
}));
