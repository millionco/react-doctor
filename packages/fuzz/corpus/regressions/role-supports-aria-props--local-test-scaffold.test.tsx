// rule: role-supports-aria-props
// weakness: test-gating
// source: PR #1304

import { vi } from "vitest";

vi.mock("toggle-button", () => ({
  default: () => <button aria-checked="true">Toggle</button>,
}));
