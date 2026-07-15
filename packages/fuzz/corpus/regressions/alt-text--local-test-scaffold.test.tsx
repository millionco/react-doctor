// rule: alt-text
// weakness: test-gating
// source: PR #1304

import { test } from "vitest";
import { ProductComponent } from "../product-component";

test("forwards image content", () => {
  render(<ProductComponent fixture={<img src="/fixture.png" />} />);
});
