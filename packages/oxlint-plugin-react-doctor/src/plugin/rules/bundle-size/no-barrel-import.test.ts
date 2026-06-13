import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noBarrelImport } from "./no-barrel-import.js";

const code = `import { Button } from "./components";
void Button;
`;

describe("no-barrel-import", () => {
  let temporaryDirectory = "";
  let entryFilename = "";

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-no-barrel-import-"));
    const componentsDirectory = path.join(temporaryDirectory, "src", "components");
    fs.mkdirSync(componentsDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(componentsDirectory, "Button.tsx"),
      "export const Button = () => null;\n",
    );
    fs.writeFileSync(
      path.join(componentsDirectory, "index.ts"),
      "export { Button } from './Button';\n",
    );
    entryFilename = path.join(temporaryDirectory, "src", "App.tsx");
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("uses page-load wording for web framework projects", () => {
    const result = runRule(noBarrelImport, code, {
      filename: entryFilename,
      settings: { "react-doctor": { framework: "nextjs" } },
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      'This ships extra code to your users & slows page load. Import directly from "./components/Button".',
    );
  });

  it("uses app-startup wording for react-native projects", () => {
    const result = runRule(noBarrelImport, code, {
      filename: entryFilename,
      settings: { "react-doctor": { framework: "react-native" } },
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      'This ships extra code in your app bundle & slows startup. Import directly from "./components/Button".',
    );
  });

  it("uses app-startup wording for expo projects", () => {
    const result = runRule(noBarrelImport, code, {
      filename: entryFilename,
      settings: { "react-doctor": { framework: "expo" } },
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain(
      "This ships extra code in your app bundle & slows startup.",
    );
  });

  it("falls back to page-load wording when the framework is unknown", () => {
    const result = runRule(noBarrelImport, code, {
      filename: entryFilename,
      settings: { "react-doctor": { framework: "unknown" } },
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain(
      "This ships extra code to your users & slows page load.",
    );
  });

  it("uses page-load wording for web-extension files inside react-native projects", () => {
    const webEntryFilename = path.join(temporaryDirectory, "src", "App.web.tsx");

    const result = runRule(noBarrelImport, code, {
      filename: webEntryFilename,
      settings: { "react-doctor": { framework: "react-native" } },
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain(
      "This ships extra code to your users & slows page load.",
    );
  });
});
