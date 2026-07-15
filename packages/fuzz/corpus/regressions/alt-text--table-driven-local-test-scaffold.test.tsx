// rule: alt-text
// weakness: table-driven-test-gating
// source: PR #1304 review

import { test } from "vitest";
import { ProductComponent } from "../product-component";

test.only.each([["portrait"], ["landscape"]])("forwards %s media", () => {
  render(<ProductComponent fixture={<img src="/fixture.png" />} />);
});
