import { describe, expect, it } from "vite-plus/test";
import { parseZodMajor } from "@react-doctor/core";

describe("parseZodMajor", () => {
  it("extracts the lowest supported major from common version specs", () => {
    expect(parseZodMajor("^4.0.0")).toBe(4);
    expect(parseZodMajor(">=3.25 <5")).toBe(3);
    expect(parseZodMajor("4 || 5")).toBe(4);
    expect(parseZodMajor("npm:zod@^4.0.0")).toBe(4);
  });

  it("returns null for upper-only or non-lower-bound ranges", () => {
    expect(parseZodMajor("<5")).toBeNull();
    expect(parseZodMajor("<5-beta.1")).toBeNull();
    expect(parseZodMajor(">3")).toBeNull();
    expect(parseZodMajor("!=4")).toBeNull();
  });

  it("does not reparse digits inside the same comparator token", () => {
    expect(parseZodMajor("18")).toBe(18);
    expect(parseZodMajor("foo18")).toBeNull();
  });
});
