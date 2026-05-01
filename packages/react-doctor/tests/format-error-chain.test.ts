import { describe, expect, it } from "vite-plus/test";
import { formatErrorChain, getErrorChainMessages } from "../src/utils/format-error-chain.js";

describe("formatErrorChain", () => {
  it("returns the single message for a flat error", () => {
    expect(formatErrorChain(new Error("boom"))).toBe("boom");
  });

  it("joins the cause chain with arrows", () => {
    const cause = new Error("ENOENT: no such file");
    const error = new Error("Error loading /repo/vite.config.ts", { cause });
    expect(formatErrorChain(error)).toBe(
      "Error loading /repo/vite.config.ts → ENOENT: no such file",
    );
  });

  it("stringifies non-error values", () => {
    expect(formatErrorChain("plain message")).toBe("plain message");
    expect(formatErrorChain(null)).toBe("null");
  });

  it("returns an empty string when there is no error to format", () => {
    expect(formatErrorChain(undefined)).toBe("");
  });

  it("stops on circular cause chains", () => {
    const error = new Error("loop");
    Object.assign(error, { cause: error });
    expect(getErrorChainMessages(error)).toEqual(["loop"]);
  });

  it("returns each message in order", () => {
    const inner = new Error("inner");
    const middle = new Error("middle", { cause: inner });
    const outer = new Error("outer", { cause: middle });
    expect(getErrorChainMessages(outer)).toEqual(["outer", "middle", "inner"]);
  });
});
