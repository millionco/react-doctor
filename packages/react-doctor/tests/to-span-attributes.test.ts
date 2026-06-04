import { describe, expect, it } from "vite-plus/test";
import { toSpanAttributes } from "../src/cli/utils/to-span-attributes.js";

describe("toSpanAttributes", () => {
  it("keeps primitive values and drops nulls", () => {
    expect(toSpanAttributes({ a: "x", count: 3, flag: true, absent: null })).toEqual({
      a: "x",
      count: 3,
      flag: true,
    });
  });

  it("returns an empty object when every value is null", () => {
    expect(toSpanAttributes({ a: null, b: null })).toEqual({});
  });

  it("preserves falsy-but-present values (0, false, empty string)", () => {
    expect(toSpanAttributes({ zero: 0, no: false, empty: "" })).toEqual({
      zero: 0,
      no: false,
      empty: "",
    });
  });
});
