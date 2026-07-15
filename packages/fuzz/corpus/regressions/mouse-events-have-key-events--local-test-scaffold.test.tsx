// rule: mouse-events-have-key-events
// weakness: test-gating
// source: PR #1304

import { test } from "vitest";
import { ProductComponent } from "../product-component";

test("forwards hover content", () => {
  render(<ProductComponent fixture={<div onMouseOver={onHover} />} />);
});
