import { expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { isIndexQuantityOption } from "./is-index-quantity-option.js";
import { isNodeOfType } from "./is-node-of-type.js";

it.each(["index + offset", "index++", "index * 0", "index % 2", "index + 0.5"])(
  "does not certify an unknown or non-injective quantity: %s",
  (quantity) => {
    const parsed = parseFixture(
      `(_, index) => <option key={${quantity}} value={${quantity}}>{${quantity}}</option>;`,
    );
    expect(parsed.errors).toEqual([]);
    if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected program");
    const statement = parsed.program.body[0];
    if (!isNodeOfType(statement, "ExpressionStatement")) throw new Error("Expected callback");
    expect(isIndexQuantityOption(statement.expression)).toBe(false);
  },
);
