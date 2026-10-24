import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { collectCrossFileDependencyProbes } from "./cross-file-dependencies.js";
import { hasCurrentContextRecordEnvironment } from "./rules/state-and-effects/utils/has-current-context-record-environment.js";
import { resetFilesystemCaches } from "./utils/reset-filesystem-caches.js";

let temporaryDirectory = "";
const source = 'import { useEffect, useState } from "react"; export const Panel = () => null;';

const writeFixture = (relativePath: string, contents: string): string => {
  const filename = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, contents);
  return filename;
};

const collect = (filename: string) =>
  collectCrossFileDependencyProbes({
    absoluteFilePath: filename,
    sourceText: fs.readFileSync(filename, "utf8"),
    ruleIds: ["no-adjust-state-on-prop-change"],
  });

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-context-record-"));
  resetFilesystemCaches();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  resetFilesystemCaches();
});

describe("current-context record environment read set", () => {
  it("records all absent React provider targets and replays their probes", () => {
    const config = writeFixture(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          jsx: "react-jsx",
          baseUrl: ".",
          paths: {
            react: ["./runtime/react"],
            "react/jsx-runtime": ["./runtime/jsx"],
            "react/jsx-dev-runtime": ["./runtime/jsx-dev"],
          },
        },
      }),
    );
    const filename = writeFixture("src/Panel.tsx", source);
    expect(hasCurrentContextRecordEnvironment(filename)).toBe(true);
    for (const trace of [collect(filename), collect(filename)]) {
      expect(trace).not.toBeNull();
      expect(trace?.contentPaths.has(config)).toBe(true);
      for (const relativePath of ["runtime/react.ts", "runtime/jsx.ts", "runtime/jsx-dev.ts"])
        expect(trace?.existencePaths.has(path.join(temporaryDirectory, relativePath))).toBe(true);
    }
  });

  it.each([
    ["react", "runtime/react.ts"],
    ["react/jsx-runtime", "runtime/jsx.ts"],
    ["react/jsx-dev-runtime", "runtime/jsx-dev.ts"],
  ])(
    "observes appearance and deletion of %s without editing configuration",
    (moduleSource, relativePath) => {
      writeFixture(
        "tsconfig.json",
        JSON.stringify({
          compilerOptions: {
            jsx: "react-jsx",
            baseUrl: ".",
            paths: { [moduleSource]: ["./" + relativePath.replace(/\.ts$/, "")] },
          },
        }),
      );
      const filename = writeFixture("src/Panel.tsx", source);
      const target = path.join(temporaryDirectory, relativePath);
      expect(hasCurrentContextRecordEnvironment(filename)).toBe(true);
      expect(collect(filename)?.existencePaths.has(target)).toBe(true);
      writeFixture(relativePath, "export const replaced = true;");
      resetFilesystemCaches();
      expect(hasCurrentContextRecordEnvironment(filename)).toBe(false);
      expect(collect(filename)?.existencePaths.has(target)).toBe(true);
      fs.unlinkSync(target);
      resetFilesystemCaches();
      expect(hasCurrentContextRecordEnvironment(filename)).toBe(true);
      expect(collect(filename)?.existencePaths.has(target)).toBe(true);
    },
  );

  it("retains external JSX extends content even with an empty paths map", () => {
    const parent = writeFixture(
      "parent.json",
      JSON.stringify({ compilerOptions: { jsxImportSource: "react" } }),
    );
    const config = writeFixture(
      "project/tsconfig.json",
      JSON.stringify({ extends: "../parent.json", compilerOptions: { paths: {} } }),
    );
    writeFixture("project/package.json", '{"private":true}');
    const filename = writeFixture("project/src/Panel.tsx", source);
    expect(hasCurrentContextRecordEnvironment(filename)).toBe(true);
    const trace = collect(filename);
    expect(trace?.contentPaths.has(config)).toBe(true);
    expect(trace?.contentPaths.has(parent)).toBe(true);
    const before = fs.statSync(parent);
    const oldSource = fs.readFileSync(parent, "utf8");
    const changedSource = oldSource.replace("react", "other");
    expect(changedSource.length).toBe(oldSource.length);
    fs.writeFileSync(parent, changedSource);
    fs.utimesSync(parent, before.atime, before.mtime);
    resetFilesystemCaches();
    expect(hasCurrentContextRecordEnvironment(filename)).toBe(false);
    expect(collect(filename)?.contentPaths.has(parent)).toBe(true);
  });

  it("keeps pre-existing imported effect helper dependencies", () => {
    const helper = writeFixture("src/helper.ts", "export const selectVisible = values => values;");
    const filename = writeFixture(
      "src/Panel.tsx",
      'import { selectVisible } from "./helper"; export const Panel = ({values}) => selectVisible(values);',
    );
    expect(collect(filename)?.contentPaths.has(helper)).toBe(true);
  });
});
