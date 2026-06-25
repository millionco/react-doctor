import { InvalidArgumentError } from "commander";
import { describe, expect, it } from "vite-plus/test";
import { parseViewport } from "../src/cli/utils/parse-viewport.js";

describe("parseViewport", () => {
  it("parses WIDTHxHEIGHT into pixel dimensions", () => {
    expect(parseViewport("390x844")).toEqual({ width: 390, height: 844 });
    expect(parseViewport(" 1280X720 ")).toEqual({ width: 1280, height: 720 });
  });

  it("rejects malformed or zero-sized values with a usage error", () => {
    for (const value of ["", "390", "390*844", "abc", "0x844", "390x0"]) {
      expect(() => parseViewport(value)).toThrow(InvalidArgumentError);
    }
  });
});
