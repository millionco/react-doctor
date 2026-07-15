// rule: alt-text
// weakness: tagged-table-driven-test-gating
// source: PR #1304 review

import { test } from "vitest";
import { ProductComponent } from "../product-component";

test.each`
  layout
  portrait
`("forwards $layout media", () => {
  render(<ProductComponent fixture={<img src="/fixture.png" />} />);
});
