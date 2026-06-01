import { describe, expect, it } from "vite-plus/test";
import { normalizeHelpInvocation } from "../src/cli/utils/normalize-help-command.js";

const KNOWN_COMMANDS = ["install", "setup", "version"];

const normalize = (userArguments: ReadonlyArray<string>): string[] =>
  normalizeHelpInvocation(["node", "react-doctor", ...userArguments], KNOWN_COMMANDS).slice(2);

describe("normalizeHelpInvocation", () => {
  it("rewrites a bare `help` into the root `--help`", () => {
    expect(normalize(["help"])).toEqual(["--help"]);
  });

  it("rewrites `help <command>` into `<command> --help`", () => {
    expect(normalize(["help", "install"])).toEqual(["install", "--help"]);
    expect(normalize(["help", "setup"])).toEqual(["setup", "--help"]);
    expect(normalize(["help", "version"])).toEqual(["version", "--help"]);
  });

  it("falls back to root help when the target is not a known command", () => {
    expect(normalize(["help", "bogus"])).toEqual(["--help"]);
  });

  it("finds the subcommand target past intervening flags", () => {
    expect(normalize(["help", "--no-color", "install"])).toEqual(["install", "--help"]);
    expect(normalize(["help", "--no-color"])).toEqual(["--help"]);
  });

  it("leaves a non-leading `help` token untouched (e.g. a flag value)", () => {
    expect(normalize(["--project", "help"])).toEqual(["--project", "help"]);
    expect(normalize(["."])).toEqual(["."]);
  });

  it("does not treat `help` as a command target argument", () => {
    // `help install` is help-for-install, never a directory scan.
    expect(normalize(["help", "install"])).not.toContain(".");
  });
});
