// rule: iframe-has-title
// weakness: test-gating
// source: PR #1304

import { test } from "vitest";
import { ProductComponent } from "../product-component";

test("forwards frame content", () => {
  render(<ProductComponent fixture={<iframe src="about:blank" />} />);
});
