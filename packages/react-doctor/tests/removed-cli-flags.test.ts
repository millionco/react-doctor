import { describe, expect, it } from "vite-plus/test";
import { CliInputError } from "../src/cli/utils/cli-input-error.js";
import { assertNoRemovedFlags } from "../src/cli/utils/removed-cli-flags.js";

const argv = (...args: string[]): string[] => ["node", "react-doctor", ...args];

describe("assertNoRemovedFlags", () => {
  it("rejects a removed flag with migration guidance instead of dropping it", () => {
    expect(() => assertNoRemovedFlags(argv("--full"))).toThrow(/`--full` was removed/);
    expect(() => assertNoRemovedFlags(argv(".", "--explain"))).toThrow(/why <file>:<line>/);
    expect(() => assertNoRemovedFlags(argv("--pr-comment"))).toThrow(/GitHub Action/);
  });

  it("throws a CliInputError so it renders as a clean user error, not a crash", () => {
    expect(() => assertNoRemovedFlags(argv("--why", "src/App.tsx:10"))).toThrow(CliInputError);
  });

  it("matches a removed flag passed with an inline value", () => {
    expect(() => assertNoRemovedFlags(argv("--full=true"))).toThrow(/was removed/);
  });

  it("allows the `why` command, current flags, and positional args after `--`", () => {
    expect(() => assertNoRemovedFlags(argv("why", "src/App.tsx:10"))).not.toThrow();
    expect(() =>
      assertNoRemovedFlags(argv(".", "--diff", "false", "--blocking", "error")),
    ).not.toThrow();
    expect(() => assertNoRemovedFlags(argv("--", "--full"))).not.toThrow();
  });
});
