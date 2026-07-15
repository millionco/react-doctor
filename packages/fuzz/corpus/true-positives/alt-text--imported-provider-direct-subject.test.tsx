// rule: alt-text
// weakness: imported-provider-test-gating
// source: PR #1304 review

import { test } from "vitest";
import { ProductProvider } from "../product-provider";

test("renders direct content", () => {
  render(
    <ProductProvider>
      <img src="/subject.png" />
    </ProductProvider>,
  );
});
