import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { inkNoRawText } from "../rules/ink/ink-no-raw-text.js";
import { inkCtrlCHandlerRequiresExitOption } from "../rules/ink/ink-ctrl-c-handler-requires-exit-option.js";
import { runRule } from "../../test-utils/run-rule.js";
import { resetManifestCaches } from "./read-nearest-package-manifest.js";
import { isInkVersionAtLeast } from "./resolve-ink-version.js";
import { wrapInkRule } from "./wrap-ink-rule.js";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-ink-version-"));

const createPackageFile = (packageName: string, inkVersion: string): string => {
  const packageDirectory = path.join(temporaryDirectory, packageName);
  const sourceDirectory = path.join(packageDirectory, "src");
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(packageDirectory, "package.json"),
    JSON.stringify({ dependencies: { ink: inkVersion } }),
  );
  return path.join(sourceDirectory, "app.tsx");
};

describe("Ink version resolution", () => {
  beforeEach(() => resetManifestCaches());
  afterAll(() => fs.rmSync(temporaryDirectory, { force: true, recursive: true }));

  it("uses the nearest owning package in mixed monorepos", () => {
    const modernFile = createPackageFile("modern", "^7.1.0");
    const legacyFile = createPackageFile("legacy", "^2.0.0");
    expect(isInkVersionAtLeast(modernFile, "7.1.0")).toBe(true);
    expect(isInkVersionAtLeast(legacyFile, "3.0.0")).toBe(false);
  });

  it("fails closed for unresolved workspace and dist-tag specs", () => {
    expect(isInkVersionAtLeast(createPackageFile("workspace", "workspace:*"), "3.0.0")).toBe(false);
    expect(isInkVersionAtLeast(createPackageFile("tag", "latest"), "3.0.0")).toBe(false);
  });

  it("prefers an installed package version over the declared range", () => {
    const sourceFile = createPackageFile("installed", "^3.0.0");
    const installedPackageDirectory = path.join(
      temporaryDirectory,
      "installed",
      "node_modules",
      "ink",
    );
    fs.mkdirSync(installedPackageDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(installedPackageDirectory, "package.json"),
      JSON.stringify({ name: "ink", version: "7.1.1" }),
    );
    expect(isInkVersionAtLeast(sourceFile, "7.1.0")).toBe(true);
  });

  it("fails closed when the installed package version is invalid", () => {
    const sourceFile = createPackageFile("invalid-installed", "^7.1.0");
    const installedPackageDirectory = path.join(
      temporaryDirectory,
      "invalid-installed",
      "node_modules",
      "ink",
    );
    fs.mkdirSync(installedPackageDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(installedPackageDirectory, "package.json"),
      JSON.stringify({ name: "ink", version: "unknown" }),
    );
    expect(isInkVersionAtLeast(sourceFile, "3.0.0")).toBe(false);

    const trailingGarbageFile = createPackageFile("invalid-installed-suffix", "^7.1.0");
    const trailingGarbagePackageDirectory = path.join(
      temporaryDirectory,
      "invalid-installed-suffix",
      "node_modules",
      "ink",
    );
    fs.mkdirSync(trailingGarbagePackageDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(trailingGarbagePackageDirectory, "package.json"),
      JSON.stringify({ name: "ink", version: "7.1.0garbage" }),
    );
    expect(isInkVersionAtLeast(trailingGarbageFile, "3.0.0")).toBe(false);
  });

  it("uses the lowest supported branch of a declared range", () => {
    const sourceFile = createPackageFile("range", "^6.8.0 || ^7.1.0");
    expect(isInkVersionAtLeast(sourceFile, "6.8.0")).toBe(true);
    expect(isInkVersionAtLeast(sourceFile, "7.0.0")).toBe(false);
  });

  it("orders prereleases below their matching stable version", () => {
    const sourceFile = createPackageFile("prerelease", "7.1.0-beta.1");
    expect(isInkVersionAtLeast(sourceFile, "7.1.0")).toBe(false);
  });

  it("suppresses a wrapped rule below its Ink introduction version", () => {
    const modernFile = createPackageFile("rule-modern", "7.1.1");
    const legacyFile = createPackageFile("rule-legacy", "2.9.0");
    const wrappedRule = wrapInkRule(inkNoRawText);
    const code = `import {Box} from "ink"; const App=()=> <Box>hello</Box>;`;
    expect(runRule(wrappedRule, code, { filename: modernFile }).diagnostics).toHaveLength(1);
    expect(runRule(wrappedRule, code, { filename: legacyFile }).diagnostics).toHaveLength(0);
  });

  it("enables the Ctrl-C rule for Ink 3", () => {
    const sourceFile = createPackageFile("ctrl-c-ink-3", "3.0.0");
    const wrappedRule = wrapInkRule(inkCtrlCHandlerRequiresExitOption);
    const code = `import {render,useInput} from "ink"; const App=()=>{useInput((input,key)=>{if(key.ctrl&&input==="c") work()});return null};render(<App/>);`;
    expect(runRule(wrappedRule, code, { filename: sourceFile }).diagnostics).toHaveLength(1);
  });
});
