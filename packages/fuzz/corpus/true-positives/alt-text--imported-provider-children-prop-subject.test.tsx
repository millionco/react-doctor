// rule: alt-text
// weakness: imported-provider-children-prop-gating
// source: PR #1304 review

import { test } from "vitest";
import { ProductProvider } from "../product-provider";

test("renders direct children", () => {
  render(<ProductProvider children={<img src="/subject.png" />} />);
});
