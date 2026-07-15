// rule: role-has-required-aria-props
// weakness: test-gating
// source: PR #1304

import { test } from "vitest";
import { ProductComponent } from "../product-component";

test("forwards checkbox content", () => {
  render(<ProductComponent fixture={<div role="checkbox" />} />);
});
