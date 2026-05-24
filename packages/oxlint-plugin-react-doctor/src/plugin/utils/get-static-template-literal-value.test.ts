import { describe, expect, it } from "vite-plus/test";
import { getStaticTemplateLiteralValue } from "./get-static-template-literal-value.js";

describe("getStaticTemplateLiteralValue", () => {
  it("returns the cooked value for a no-substitution template literal", () => {
    expect(
      getStaticTemplateLiteralValue({
        expressions: [],
        quasis: [{ value: { cooked: "button", raw: "button" } }],
      }),
    ).toBe("button");
  });

  it("falls back to raw text when cooked is unavailable", () => {
    expect(
      getStaticTemplateLiteralValue({
        expressions: [],
        quasis: [{ value: { cooked: null, raw: "button" } }],
      }),
    ).toBe("button");
  });

  it("treats omitted empty expressions as static", () => {
    expect(
      getStaticTemplateLiteralValue({
        quasis: [{ value: { cooked: "#", raw: "#" } }],
      }),
    ).toBe("#");
  });

  it("returns null for dynamic or malformed template literals", () => {
    expect(
      getStaticTemplateLiteralValue({
        expressions: [{}],
        quasis: [{ value: { cooked: "", raw: "" } }, { value: { cooked: "", raw: "" } }],
      }),
    ).toBeNull();
    expect(getStaticTemplateLiteralValue({ expressions: [] })).toBeNull();
  });
});
