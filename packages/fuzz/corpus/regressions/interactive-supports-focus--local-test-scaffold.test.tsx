// rule: interactive-supports-focus
// weakness: test-gating
// source: PR #1304

import { test } from "vitest";
import { ProductComponent } from "../product-component";

test("forwards interaction content", () => {
  render(<ProductComponent fixture={<div role="button" onClick={onActivate} />} />);
});
