import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { hasTypeOnlyDefaultExportErasureConfiguration } from "./resolve-tsconfig-alias.js";

interface EmissionConfigurationCase {
  readonly configuration: string | undefined;
  readonly parentConfiguration: string | undefined;
  readonly expected: boolean;
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "type-export-config-"));
let fixtureNumber = 0;
afterAll(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

const configurationCases: ReadonlyArray<EmissionConfigurationCase> = [
  { configuration: "{}", parentConfiguration: undefined, expected: true },
  {
    configuration: '{"compilerOptions":{"verbatimModuleSyntax":false}}',
    parentConfiguration: undefined,
    expected: true,
  },
  {
    configuration: '{"compilerOptions":{"verbatimModuleSyntax":true}}',
    parentConfiguration: undefined,
    expected: false,
  },
  {
    configuration: '{"compilerOptions":{"verbatimModuleSyntax":"false"}}',
    parentConfiguration: undefined,
    expected: false,
  },
  { configuration: '{"compilerOptions":[]}', parentConfiguration: undefined, expected: false },
  { configuration: "[]", parentConfiguration: undefined, expected: false },
  { configuration: "broken", parentConfiguration: undefined, expected: false },
  { configuration: '{"extends":[]}', parentConfiguration: undefined, expected: false },
  {
    configuration: '{"extends":"./missing.json"}',
    parentConfiguration: undefined,
    expected: false,
  },
  {
    configuration: '{"extends":"./tsconfig.json"}',
    parentConfiguration: undefined,
    expected: false,
  },
  { configuration: '{"extends":"./parent.json"}', parentConfiguration: "{}", expected: true },
  {
    configuration: '{"extends":"./parent.json","compilerOptions":{"paths":{}}}',
    parentConfiguration: '{"compilerOptions":{"verbatimModuleSyntax":true}}',
    expected: false,
  },
  {
    configuration: '{"extends":"./parent.json","compilerOptions":{"verbatimModuleSyntax":false}}',
    parentConfiguration: '{"compilerOptions":{"verbatimModuleSyntax":true}}',
    expected: false,
  },
  {
    configuration: '{"extends":"./parent.json"}',
    parentConfiguration: '{"extends":"./tsconfig.json"}',
    expected: false,
  },
  { configuration: undefined, parentConfiguration: undefined, expected: false },
];

describe("type-only default export configuration", () => {
  it.each(configurationCases)(
    "inspects $configuration conservatively",
    ({ configuration, parentConfiguration, expected }) => {
      fixtureNumber += 1;
      const directory = path.join(temporaryDirectory, String(fixtureNumber));
      fs.mkdirSync(directory);
      if (configuration !== undefined)
        fs.writeFileSync(path.join(directory, "tsconfig.json"), configuration);
      if (parentConfiguration !== undefined)
        fs.writeFileSync(path.join(directory, "parent.json"), parentConfiguration);
      expect(hasTypeOnlyDefaultExportErasureConfiguration(directory)).toBe(expected);
    },
  );
  it("uses only the root tsconfig even when a nested config would permit erasure", () => {
    fixtureNumber += 1;
    const directory = path.join(temporaryDirectory, String(fixtureNumber));
    fs.mkdirSync(path.join(directory, "nested"), { recursive: true });
    fs.writeFileSync(
      path.join(directory, "tsconfig.json"),
      '{"compilerOptions":{"verbatimModuleSyntax":true}}',
    );
    fs.writeFileSync(path.join(directory, "nested", "tsconfig.json"), "{}");
    expect(hasTypeOnlyDefaultExportErasureConfiguration(directory)).toBe(false);
  });
  it.each(["absolute", "package"])("refuses unsupported %s parent resolution", (parentKind) => {
    fixtureNumber += 1;
    const directory = path.join(temporaryDirectory, String(fixtureNumber));
    fs.mkdirSync(directory);
    const parentSpecifier = parentKind === "absolute" ? "/emission-config.json" : "emission-config";
    expect(path.isAbsolute(parentSpecifier)).toBe(parentKind === "absolute");
    const misleadingParent = path.join(
      directory,
      "node_modules",
      `${parentSpecifier}${parentSpecifier.endsWith(".json") ? "" : ".json"}`,
    );
    fs.mkdirSync(path.dirname(misleadingParent), { recursive: true });
    fs.writeFileSync(misleadingParent, "{}");
    fs.writeFileSync(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({ extends: parentSpecifier }),
    );
    expect(hasTypeOnlyDefaultExportErasureConfiguration(directory)).toBe(false);
  });
});
