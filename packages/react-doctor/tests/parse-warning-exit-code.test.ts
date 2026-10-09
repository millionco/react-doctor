import { Command, InvalidArgumentError } from "commander";
import { describe, expect, it } from "vite-plus/test";
import { parseWarningExitCode } from "../src/cli/utils/parse-warning-exit-code.js";

describe("parseWarningExitCode", () => {
  it.each(["2", "123", "255"])("accepts %s", (value) => {
    expect(parseWarningExitCode(value)).toBe(Number(value));
  });

  it.each([
    "",
    " ",
    "0",
    "1",
    "-1",
    "256",
    "1.5",
    "123abc",
    "NaN",
    "Infinity",
    "0x7b",
    "1e2",
    " 123 ",
  ])("rejects %j", (value) => {
    expect(() => parseWarningExitCode(value)).toThrow(InvalidArgumentError);
  });

  it.each([["--warning-exit-code", "123"], ["--warning-exit-code=123"]])(
    "parses the option through Commander: %j",
    (...arguments_) => {
      const command = new Command().option(
        "--warning-exit-code <code>",
        "warning exit code",
        parseWarningExitCode,
      );
      command.parse(arguments_, { from: "user" });
      expect(command.opts().warningExitCode).toBe(123);
    },
  );
});
