import { describe, expect, it } from "vite-plus/test";
import { isDebugFlagEnabled } from "../src/cli/utils/is-debug-flag.js";

describe("isDebugFlagEnabled", () => {
  it("is true when --debug appears anywhere in argv", () => {
    expect(isDebugFlagEnabled(["node", "react-doctor", ".", "--debug"])).toBe(true);
    expect(isDebugFlagEnabled(["node", "react-doctor", "--debug", "--json"])).toBe(true);
  });

  it("is false when --debug is absent", () => {
    expect(isDebugFlagEnabled(["node", "react-doctor", "."])).toBe(false);
    expect(isDebugFlagEnabled(["node", "react-doctor", "--verbose"])).toBe(false);
  });

  it("does not match a value that merely contains the word debug", () => {
    expect(isDebugFlagEnabled(["node", "react-doctor", "--project", "debug"])).toBe(false);
  });
});
