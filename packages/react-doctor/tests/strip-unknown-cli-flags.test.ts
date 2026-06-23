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
        "--debug",
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
      "--debug",
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

  it("keeps --scope / --base and consumes their values (no value leaks as a positional)", () => {
    // Regression: the action invokes `react-doctor . --scope changed --changed-files-from <f>`.
    // If --scope isn't a known value-taking flag, its value `changed` leaks as a 2nd
    // positional and Commander throws "too many arguments".
    expect(
      stripUserArguments([".", "--scope", "changed", "--changed-files-from", "/tmp/changed.txt"]),
    ).toEqual([".", "--scope", "changed", "--changed-files-from", "/tmp/changed.txt"]);
    expect(stripUserArguments([".", "--scope", "lines", "--base", "main"])).toEqual([
      ".",
      "--scope",
      "lines",
      "--base",
      "main",
    ]);
  });

  it("keeps --output-dir and consumes its value (no value leaks as a positional)", () => {
    expect(stripUserArguments([".", "--output-dir", "./doctor-report"])).toEqual([
      ".",
      "--output-dir",
      "./doctor-report",
    ]);
    expect(stripUserArguments(["--output-dir=./doctor-report"])).toEqual([
      "--output-dir=./doctor-report",
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

  it("keeps browser subcommand flags and consumes --cdp's value (no value leaks as a positional)", () => {
    // Regression: without a browser flag spec, --cdp is dropped and its endpoint
    // value leaks in as a second positional, so `browser audit <url> --cdp <endpoint>`
    // makes Commander throw "too many arguments".
    expect(
      stripUserArguments([
        "browser",
        "audit",
        "https://example.com",
        "--cdp",
        "http://127.0.0.1:9456",
      ]),
    ).toEqual(["browser", "audit", "https://example.com", "--cdp", "http://127.0.0.1:9456"]);
    expect(stripUserArguments(["browser", "open", "https://example.com", "--no-launch"])).toEqual([
      "browser",
      "open",
      "https://example.com",
      "--no-launch",
    ]);
    expect(stripUserArguments(["browser", "screenshot", "--out", "shot.png", "--offline"])).toEqual(
      ["browser", "screenshot", "--out", "shot.png"],
    );
    expect(
      stripUserArguments(["browser", "screenshot", "--viewport", "390x844", "--out", "m.png"]),
    ).toEqual(["browser", "screenshot", "--viewport", "390x844", "--out", "m.png"]);
    expect(
      stripUserArguments(["browser", "eval", 'page.locator("a").click()', "--cdp", "http://x"]),
    ).toEqual(["browser", "eval", 'page.locator("a").click()', "--cdp", "http://x"]);
    // Regression: `--interaction`'s Playwright expression must not leak as a
    // positional, or `browser profile` rejects it as too many arguments.
    expect(
      stripUserArguments([
        "browser",
        "profile",
        "https://example.com",
        "--interaction",
        'page.getByText("Next").click()',
      ]),
    ).toEqual([
      "browser",
      "profile",
      "https://example.com",
      "--interaction",
      'page.getByText("Next").click()',
    ]);
  });

  it("keeps debug serve flags and consumes their values (no value leaks as a positional)", () => {
    expect(
      stripUserArguments(["debug", "serve", "--port", "9000", "--daemon", "--offline"]),
    ).toEqual(["debug", "serve", "--port", "9000", "--daemon"]);
    expect(stripUserArguments(["debug", "--json"])).toEqual(["debug", "--json"]);
    expect(stripUserArguments(["debug", "serve", "-p", "9000", "-s", "abc123", "-d"])).toEqual([
      "debug",
      "serve",
      "-p",
      "9000",
      "-s",
      "abc123",
      "-d",
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
