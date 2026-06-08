import { describe, expect, it } from "vite-plus/test";
import { stripUnknownCliFlags } from "../src/cli/utils/strip-unknown-cli-flags.js";

const stripUserArguments = (userArguments: ReadonlyArray<string>): string[] =>
  stripUnknownCliFlags(["node", "react-doctor", ...userArguments]).slice(2);

describe("stripUnknownCliFlags", () => {
  it("drops unknown root flags before Commander can treat them as directory arguments", () => {
    expect(stripUserArguments(["--offline", "."])).toEqual(["."]);
    expect(stripUserArguments([".", "--offline"])).toEqual(["."]);
  });

  it("keeps known root flags and their values", () => {
    expect(
      stripUserArguments([
        ".",
        "--no-score",
        "--project",
        "web",
        "--changed-files-from",
        "/tmp/react-doctor-changed-files.txt",
        "--category",
        "Security",
        "--diff",
        "main",
        "--fail-on=warning",
      ]),
    ).toEqual([
      ".",
      "--no-score",
      "--project",
      "web",
      "--changed-files-from",
      "/tmp/react-doctor-changed-files.txt",
      "--category",
      "Security",
      "--diff",
      "main",
      "--fail-on=warning",
    ]);
  });

  it("drops unknown install flags while keeping install options", () => {
    expect(stripUserArguments(["install", "--offline", "--cwd", ".", "--agent-hooks"])).toEqual([
      "install",
      "--cwd",
      ".",
      "--agent-hooks",
    ]);
  });

  it("keeps a trailing optional-value flag without pushing undefined", () => {
    expect(stripUserArguments(["--diff"])).toEqual(["--diff"]);
    expect(stripUserArguments([".", "--diff"])).toEqual([".", "--diff"]);
  });

  it("keeps an optional-value flag followed by another flag", () => {
    expect(stripUserArguments(["--diff", "--json"])).toEqual(["--diff", "--json"]);
  });

  it("keeps the --color / --no-color flags so the color resolver can see them", () => {
    expect(stripUserArguments([".", "--color"])).toEqual([".", "--color"]);
    expect(stripUserArguments([".", "--no-color"])).toEqual([".", "--no-color"]);
    expect(stripUserArguments(["install", "--no-color", "--cwd", "."])).toEqual([
      "install",
      "--no-color",
      "--cwd",
      ".",
    ]);
  });

  it("keeps the --no-telemetry alias for --no-score", () => {
    expect(stripUserArguments([".", "--no-telemetry"])).toEqual([".", "--no-telemetry"]);
  });

  it("keeps color flags on the version subcommand and drops unknown ones", () => {
    expect(stripUserArguments(["version", "--no-color"])).toEqual(["version", "--no-color"]);
    expect(stripUserArguments(["version", "--color"])).toEqual(["version", "--color"]);
    expect(stripUserArguments(["version", "--offline"])).toEqual(["version"]);
  });

  it("keeps rules subcommand options and positionals", () => {
    expect(
      stripUserArguments(["rules", "explain", "react-doctor/no-danger", "-c", "/tmp/project"]),
    ).toEqual(["rules", "explain", "react-doctor/no-danger", "-c", "/tmp/project"]);
    expect(
      stripUserArguments(["rules", "list", "--category", "Performance", "--configured", "--json"]),
    ).toEqual(["rules", "list", "--category", "Performance", "--configured", "--json"]);
    expect(
      stripUserArguments(["rules", "enable", "no-danger", "--severity", "error", "--offline"]),
    ).toEqual(["rules", "enable", "no-danger", "--severity", "error"]);
  });

  it("keeps the why subcommand positional and options, dropping unknown ones", () => {
    expect(
      stripUserArguments(["why", "src/App.tsx:42", "--project", "web", "-c", "/tmp/project"]),
    ).toEqual(["why", "src/App.tsx:42", "--project", "web", "-c", "/tmp/project"]);
    expect(stripUserArguments(["why", "src/App.tsx:42", "--offline"])).toEqual([
      "why",
      "src/App.tsx:42",
    ]);
  });

  it("keeps color flags on rules subcommands so the color resolver can see them", () => {
    expect(stripUserArguments(["rules", "list", "--no-color"])).toEqual([
      "rules",
      "list",
      "--no-color",
    ]);
    expect(stripUserArguments(["rules", "explain", "no-danger", "--color"])).toEqual([
      "rules",
      "explain",
      "no-danger",
      "--color",
    ]);
  });
});
