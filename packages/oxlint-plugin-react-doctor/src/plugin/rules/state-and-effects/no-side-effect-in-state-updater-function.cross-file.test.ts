import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { CROSS_FILE_BARREL_FOLLOW_DEPTH } from "../../constants/thresholds.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { __clearTsconfigAliasCacheForTests } from "../../utils/resolve-tsconfig-alias.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "state-updater-dayjs-"));
  __clearParseSourceFileCacheForTests();
  __clearTsconfigAliasCacheForTests();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeFile = (relativePath: string, contents: string): string => {
  const absolutePath = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
  return absolutePath;
};

const runConsumer = (dayjsImportSource: string) => {
  const source = `import dayjs from"${dayjsImportSource}";import{useState}from"react";const C=()=>{const[,setDate]=useState({selectedMonth:dayjs()});setDate(previous=>({...previous,selectedMonth:previous.selectedMonth.add(1,"month")}))}`;
  return runRule(noSideEffectInStateUpdaterFunction, source, {
    filename: writeFile("src/component.tsx", source),
  });
};

const writeConfigurationChain = (
  directory: string,
  fileCount: number,
  finalFileContents: string,
): void => {
  for (let configurationIndex = 1; configurationIndex <= fileCount; configurationIndex++) {
    writeFile(
      `src/${directory}/configure-${configurationIndex}.ts`,
      configurationIndex === fileCount
        ? finalFileContents
        : `import"./configure-${configurationIndex + 1}"`,
    );
  }
  writeFile(
    `src/${directory}/dayjs.ts`,
    `import"./configure-1";import dayjs from"dayjs";export default dayjs`,
  );
};

describe("no-side-effect-in-state-updater-function cross-file Day.js wrappers", () => {
  it("keeps a wrapper that only activates an immutable Day.js plugin quiet", () => {
    writeFile(
      "src/utils/dayjs.ts",
      `import dayjs from"dayjs";import customParseFormat from"dayjs/plugin/customParseFormat";dayjs.extend(customParseFormat);export default dayjs`,
    );
    expect(runConsumer("./utils/dayjs").diagnostics).toHaveLength(0);
  });

  it("follows immutable Day.js factories through multiple wrapper imports", () => {
    writeFile("src/utils/base-dayjs.ts", `import dayjs from"dayjs";export default dayjs`);
    writeFile("src/utils/middle-dayjs.ts", `import dayjs from"./base-dayjs";export default dayjs`);
    writeFile("src/utils/dayjs.ts", `import dayjs from"./middle-dayjs";export default dayjs`);
    expect(runConsumer("./utils/dayjs").diagnostics).toHaveLength(0);
  });

  it("follows immutable Day.js factories through the full wrapper depth", () => {
    for (let wrapperIndex = CROSS_FILE_BARREL_FOLLOW_DEPTH; wrapperIndex >= 1; wrapperIndex--) {
      const importSource =
        wrapperIndex === CROSS_FILE_BARREL_FOLLOW_DEPTH ? "dayjs" : `./wrapper-${wrapperIndex + 1}`;
      writeFile(
        `src/utils/wrapper-${wrapperIndex}.ts`,
        `import dayjs from"${importSource}";export default dayjs`,
      );
    }
    expect(runConsumer("./utils/wrapper-1").diagnostics).toHaveLength(0);
  });

  it("stops following immutable Day.js factories beyond the wrapper depth", () => {
    const wrapperCount = CROSS_FILE_BARREL_FOLLOW_DEPTH + 1;
    for (let wrapperIndex = wrapperCount; wrapperIndex >= 1; wrapperIndex--) {
      const importSource =
        wrapperIndex === wrapperCount ? "dayjs" : `./wrapper-${wrapperIndex + 1}`;
      writeFile(
        `src/utils/wrapper-${wrapperIndex}.ts`,
        `import dayjs from"${importSource}";export default dayjs`,
      );
    }
    expect(runConsumer("./utils/wrapper-1").diagnostics).toHaveLength(1);
  });

  it("follows aliased named Day.js factories through multiple wrappers", () => {
    writeFile(
      "src/utils/base-dayjs.ts",
      `import dayjs from"dayjs";const factory=dayjs;export{factory as makeDate}`,
    );
    writeFile(
      "src/utils/middle-dayjs.ts",
      `import{makeDate}from"./base-dayjs";const factory=makeDate;export{factory as makeDate}`,
    );
    writeFile("src/utils/dayjs.ts", `import{makeDate}from"./middle-dayjs";export default makeDate`);
    expect(runConsumer("./utils/dayjs").diagnostics).toHaveLength(0);
  });

  it("does not trust a multi-hop wrapper that activates badMutable", () => {
    writeFile(
      "src/utils/base-dayjs.ts",
      `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";dayjs.extend(badMutable);export default dayjs`,
    );
    writeFile("src/utils/middle-dayjs.ts", `import dayjs from"./base-dayjs";export default dayjs`);
    writeFile("src/utils/dayjs.ts", `import dayjs from"./middle-dayjs";export default dayjs`);
    expect(runConsumer("./utils/dayjs").diagnostics).toHaveLength(1);
  });

  it("does not trust a multi-hop wrapper around a mutable factory", () => {
    writeFile(
      "src/utils/base-dayjs.ts",
      `const mutableDate=()=>({add(){return this}});export default mutableDate`,
    );
    writeFile("src/utils/middle-dayjs.ts", `import dayjs from"./base-dayjs";export default dayjs`);
    writeFile("src/utils/dayjs.ts", `import dayjs from"./middle-dayjs";export default dayjs`);
    expect(runConsumer("./utils/dayjs").diagnostics).toHaveLength(1);
  });

  it("does not trust cyclic Day.js factory wrappers", () => {
    writeFile("src/utils/a.ts", `import dayjs from"./b";export default dayjs`);
    writeFile("src/utils/b.ts", `import dayjs from"./a";export default dayjs`);
    expect(runConsumer("./utils/a").diagnostics).toHaveLength(1);
  });

  it("does not trust a same-named wrapper around a mutable factory", () => {
    writeFile(
      "src/dayjs.ts",
      `const mutableDate=()=>({add(){return this}});export default mutableDate`,
    );
    expect(runConsumer("./dayjs").diagnostics).toHaveLength(1);
  });

  it("does not suppress a wrapper that activates Day.js badMutable", () => {
    writeFile(
      "src/utils/dayjs.ts",
      `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";dayjs.extend(badMutable);export default dayjs`,
    );
    expect(runConsumer("./utils/dayjs").diagnostics).toHaveLength(1);
  });

  it("does not suppress a Day.js wrapper when the consumer activates badMutable", () => {
    writeFile("src/utils/dayjs.ts", `import dayjs from"dayjs";export default dayjs`);
    const directSource = `import dayjs from"../utils/dayjs";import badMutable from"dayjs/plugin/badMutable";import{useState}from"react";dayjs.extend(badMutable);const C=()=>{const[,setDate]=useState({selectedMonth:dayjs()});setDate(previous=>({...previous,selectedMonth:previous.selectedMonth.add(1,"month")}))}`;
    const aliasSource = `import dayjs from"../utils/dayjs";import badMutable from"dayjs/plugin/badMutable";import{useState}from"react";const configuredDayjs=dayjs;configuredDayjs.extend(badMutable);const C=()=>{const[,setDate]=useState({selectedMonth:dayjs()});setDate(previous=>({...previous,selectedMonth:previous.selectedMonth.add(1,"month")}))}`;
    writeFile("src/utils/bad-mutable.ts", `export{default}from"dayjs/plugin/badMutable"`);
    const wrappedPluginSource = `import dayjs from"../utils/dayjs";import badMutable from"../utils/bad-mutable";import{useState}from"react";dayjs.extend(badMutable);const C=()=>{const[,setDate]=useState({selectedMonth:dayjs()});setDate(previous=>({...previous,selectedMonth:previous.selectedMonth.add(1,"month")}))}`;
    const directResult = runRule(noSideEffectInStateUpdaterFunction, directSource, {
      filename: writeFile("src/consumers/direct.tsx", directSource),
    });
    const aliasResult = runRule(noSideEffectInStateUpdaterFunction, aliasSource, {
      filename: writeFile("src/consumers/alias.tsx", aliasSource),
    });
    const wrappedPluginResult = runRule(noSideEffectInStateUpdaterFunction, wrappedPluginSource, {
      filename: writeFile("src/consumers/wrapped-plugin.tsx", wrappedPluginSource),
    });
    expect([
      directResult.diagnostics.length,
      aliasResult.diagnostics.length,
      wrappedPluginResult.diagnostics.length,
    ]).toEqual([1, 1, 1]);
  });

  it("does not suppress Day.js with a transitively re-exported badMutable plugin", () => {
    writeFile("src/plugins/one.ts", `export{default}from"dayjs/plugin/badMutable"`);
    writeFile("src/plugins/two.ts", `export{default}from"./one"`);
    const source = `import dayjs from"dayjs";import badMutable from"./plugins/two";import{useState}from"react";dayjs.extend(badMutable);const C=()=>{const[,setDate]=useState({selectedMonth:dayjs()});setDate(previous=>({...previous,selectedMonth:previous.selectedMonth.add(1,"month")}))}`;
    const result = runRule(noSideEffectInStateUpdaterFunction, source, {
      filename: writeFile("src/component.tsx", source),
    });
    const unusedSource = `import dayjs from"dayjs";import badMutable from"../plugins/two";import{useState}from"react";void badMutable;const C=()=>{const[,setDate]=useState({selectedMonth:dayjs()});setDate(previous=>({...previous,selectedMonth:previous.selectedMonth.add(1,"month")}))}`;
    const unusedResult = runRule(noSideEffectInStateUpdaterFunction, unusedSource, {
      filename: writeFile("src/consumers/unused.tsx", unusedSource),
    });
    expect([result.diagnostics.length, unusedResult.diagnostics.length]).toEqual([1, 0]);
  });

  it("does not suppress a wrapper with side-effect-imported badMutable configuration", () => {
    writeFile(
      "src/utils/configure-dayjs.ts",
      `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";dayjs.extend(badMutable)`,
    );
    writeFile(
      "src/utils/dayjs.ts",
      `import"./configure-dayjs";import dayjs from"dayjs";export default dayjs`,
    );
    expect(runConsumer("./utils/dayjs").diagnostics).toHaveLength(1);
  });

  it("fails closed when badMutable activation crosses the configuration depth frontier", () => {
    const badMutableActivation = `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";dayjs.extend(badMutable)`;
    writeConfigurationChain(
      "configuration-at-cap",
      CROSS_FILE_BARREL_FOLLOW_DEPTH - 1,
      badMutableActivation,
    );
    writeConfigurationChain(
      "configuration-over-cap",
      CROSS_FILE_BARREL_FOLLOW_DEPTH,
      badMutableActivation,
    );
    expect([
      runConsumer("./configuration-at-cap/dayjs").diagnostics.length,
      runConsumer("./configuration-over-cap/dayjs").diagnostics.length,
    ]).toEqual([1, 1]);
  });

  it("preserves immutable Day.js proofs only through fully explored configuration chains", () => {
    writeConfigurationChain(
      "immutable-at-cap",
      CROSS_FILE_BARREL_FOLLOW_DEPTH - 1,
      `export const marker=1`,
    );
    writeConfigurationChain(
      "immutable-over-cap",
      CROSS_FILE_BARREL_FOLLOW_DEPTH,
      `export const marker=1`,
    );
    expect([
      runConsumer("./immutable-at-cap/dayjs").diagnostics.length,
      runConsumer("./immutable-over-cap/dayjs").diagnostics.length,
    ]).toEqual([0, 1]);
  });

  it("keeps a missing dependency beyond the configuration frontier quiet", () => {
    writeConfigurationChain(
      "missing-over-cap",
      CROSS_FILE_BARREL_FOLLOW_DEPTH - 1,
      `import"./missing";export const marker=1`,
    );
    expect(runConsumer("./missing-over-cap/dayjs").diagnostics).toHaveLength(0);
  });

  it("revisits configuration dependencies reached through a shallower path in either order", () => {
    for (const importOrder of ["deep-first", "shallow-first"]) {
      for (
        let configurationIndex = 1;
        configurationIndex < CROSS_FILE_BARREL_FOLLOW_DEPTH;
        configurationIndex++
      ) {
        writeFile(
          `src/${importOrder}/configure-${configurationIndex}.ts`,
          configurationIndex === CROSS_FILE_BARREL_FOLLOW_DEPTH - 1
            ? `import"./shared"`
            : `import"./configure-${configurationIndex + 1}"`,
        );
      }
      writeFile(`src/${importOrder}/shared.ts`, `export const marker=1`);
      const dependencyImports =
        importOrder === "deep-first"
          ? `import"./configure-1";import"./shared"`
          : `import"./shared";import"./configure-1"`;
      writeFile(
        `src/${importOrder}/dayjs.ts`,
        `${dependencyImports};import dayjs from"dayjs";export default dayjs`,
      );
    }
    expect([
      runConsumer("./deep-first/dayjs").diagnostics.length,
      runConsumer("./shallow-first/dayjs").diagnostics.length,
    ]).toEqual([0, 0]);
  });

  it("keeps a clean cyclic Day.js configuration graph quiet", () => {
    writeFile("src/configuration-cycle/a.ts", `import"./b"`);
    writeFile("src/configuration-cycle/b.ts", `import"./a"`);
    writeFile(
      "src/configuration-cycle/dayjs.ts",
      `import"./a";import dayjs from"dayjs";export default dayjs`,
    );
    expect(runConsumer("./configuration-cycle/dayjs").diagnostics).toHaveLength(0);
  });

  it("does not suppress a wrapper with named-imported badMutable configuration", () => {
    writeFile(
      "src/utils/configure-dayjs.ts",
      `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";dayjs.extend(badMutable);export const marker=1`,
    );
    writeFile(
      "src/utils/dayjs.ts",
      `import{marker}from"./configure-dayjs";void marker;import dayjs from"dayjs";export default dayjs`,
    );
    expect(runConsumer("./utils/dayjs").diagnostics).toHaveLength(1);
  });

  it("only applies badMutable configuration from executed local functions", () => {
    writeFile(
      "src/config/inactive.ts",
      `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";export const enableBadMutable=()=>dayjs.extend(badMutable)`,
    );
    writeFile(
      "src/config/active.ts",
      `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";const enableBadMutable=()=>dayjs.extend(badMutable);enableBadMutable()`,
    );
    writeFile(
      "src/config/synchronous-callback.ts",
      `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";const enableBadMutable=()=>dayjs.extend(badMutable);[0].forEach(enableBadMutable)`,
    );
    writeFile(
      "src/config/empty-callback.ts",
      `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";const enableBadMutable=()=>dayjs.extend(badMutable);[].forEach(enableBadMutable)`,
    );
    writeFile(
      "src/wrappers/inactive.ts",
      `import{enableBadMutable}from"../config/inactive";void enableBadMutable;import dayjs from"dayjs";export default dayjs`,
    );
    writeFile(
      "src/wrappers/active.ts",
      `import"../config/active";import dayjs from"dayjs";export default dayjs`,
    );
    writeFile(
      "src/wrappers/synchronous-callback.ts",
      `import"../config/synchronous-callback";import dayjs from"dayjs";export default dayjs`,
    );
    writeFile(
      "src/wrappers/empty-callback.ts",
      `import"../config/empty-callback";import dayjs from"dayjs";export default dayjs`,
    );
    expect([
      runConsumer("./wrappers/inactive").diagnostics.length,
      runConsumer("./wrappers/active").diagnostics.length,
      runConsumer("./wrappers/synchronous-callback").diagnostics.length,
      runConsumer("./wrappers/empty-callback").diagnostics.length,
    ]).toEqual([0, 1, 1, 0]);
  });

  it("follows runtime ESM imports without executing type-only imports", () => {
    writeFile(
      "src/config/default.ts",
      `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";dayjs.extend(badMutable);export default 1`,
    );
    writeFile(
      "src/config/namespace.ts",
      `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";dayjs.extend(badMutable);export const marker=1`,
    );
    writeFile(
      "src/config/type-only.ts",
      `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";dayjs.extend(badMutable);export interface Marker{value:string}`,
    );
    writeFile(
      "src/config/cycle-a.ts",
      `import{markerB}from"./cycle-b";export const markerA=markerB`,
    );
    writeFile(
      "src/config/cycle-b.ts",
      `import{markerA}from"./cycle-a";export const markerB=markerA`,
    );
    writeFile(
      "src/wrappers/default.ts",
      `import marker from"../config/default";void marker;import dayjs from"dayjs";export default dayjs`,
    );
    writeFile(
      "src/wrappers/namespace.ts",
      `import*as configuration from"../config/namespace";void configuration.marker;import dayjs from"dayjs";export default dayjs`,
    );
    writeFile(
      "src/wrappers/type-declaration.ts",
      `import type{Marker}from"../config/type-only";type Alias=Marker;import dayjs from"dayjs";export default dayjs`,
    );
    writeFile(
      "src/wrappers/type-specifier.ts",
      `import{type Marker}from"../config/type-only";type Alias=Marker;import dayjs from"dayjs";export default dayjs`,
    );
    writeFile(
      "src/wrappers/cycle.ts",
      `import{markerA}from"../config/cycle-a";void markerA;import dayjs from"dayjs";export default dayjs`,
    );
    expect([
      runConsumer("./wrappers/default").diagnostics.length,
      runConsumer("./wrappers/namespace").diagnostics.length,
      runConsumer("./wrappers/type-declaration").diagnostics.length,
      runConsumer("./wrappers/type-specifier").diagnostics.length,
      runConsumer("./wrappers/cycle").diagnostics.length,
    ]).toEqual([1, 1, 0, 0, 0]);
  });

  it("keeps runtime-import activation stable across cycle traversal order", () => {
    const writeCycle = (directory: string) => {
      writeFile(
        `src/${directory}/configure.ts`,
        `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";dayjs.extend(badMutable)`,
      );
      writeFile(
        `src/${directory}/a.ts`,
        `import dayjsB from"./b";void dayjsB;import"./configure";import dayjs from"dayjs";export default dayjs`,
      );
      writeFile(
        `src/${directory}/b.ts`,
        `import dayjsA from"./a";void dayjsA;import dayjs from"dayjs";export default dayjs`,
      );
    };
    writeCycle("a-first");
    writeCycle("b-first");
    expect([
      runConsumer("./a-first/a").diagnostics.length,
      runConsumer("./a-first/b").diagnostics.length,
      runConsumer("./a-first/a").diagnostics.length,
      runConsumer("./b-first/b").diagnostics.length,
      runConsumer("./b-first/a").diagnostics.length,
      runConsumer("./b-first/b").diagnostics.length,
    ]).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("revisits a runtime dependency reached later through a shorter path", () => {
    writeFile("src/direct-depth/a.ts", `import"./b"`);
    writeFile("src/direct-depth/b.ts", `import"./c"`);
    writeFile("src/direct-depth/c.ts", `import"./d"`);
    writeFile("src/direct-depth/d.ts", `import"./configure"`);
    writeFile(
      "src/direct-depth/configure.ts",
      `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";dayjs.extend(badMutable)`,
    );
    const source = `import"./direct-depth/a";import"./direct-depth/d";import dayjs from"dayjs";import{useState}from"react";const C=()=>{const[,setDate]=useState({selectedMonth:dayjs()});setDate(previous=>({...previous,selectedMonth:previous.selectedMonth.add(1,"month")}))}`;
    const result = runRule(noSideEffectInStateUpdaterFunction, source, {
      filename: writeFile("src/component.tsx", source),
    });
    const reversedSource = `import"./direct-depth/d";import"./direct-depth/a";import dayjs from"dayjs";import{useState}from"react";const C=()=>{const[,setDate]=useState({selectedMonth:dayjs()});setDate(previous=>({...previous,selectedMonth:previous.selectedMonth.add(1,"month")}))}`;
    const reversedResult = runRule(noSideEffectInStateUpdaterFunction, reversedSource, {
      filename: writeFile("src/reversed.tsx", reversedSource),
    });
    expect([result.diagnostics.length, reversedResult.diagnostics.length]).toEqual([1, 1]);
  });

  it("follows runtime re-exports without executing type-only re-exports", () => {
    writeFile(
      "src/reexports/configure.ts",
      `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";dayjs.extend(badMutable);export const marker=1;export interface Marker{value:string}`,
    );
    writeFile(
      "src/reexports/named.ts",
      `export{marker}from"./configure";import dayjs from"dayjs";export default dayjs`,
    );
    writeFile(
      "src/reexports/all.ts",
      `export*from"./configure";import dayjs from"dayjs";export default dayjs`,
    );
    writeFile(
      "src/reexports/namespace.ts",
      `export*as configuration from"./configure";import dayjs from"dayjs";export default dayjs`,
    );
    writeFile(
      "src/reexports/type-named.ts",
      `export type{Marker}from"./configure";import dayjs from"dayjs";export default dayjs`,
    );
    writeFile(
      "src/reexports/type-all.ts",
      `export type*from"./configure";import dayjs from"dayjs";export default dayjs`,
    );
    expect([
      runConsumer("./reexports/named").diagnostics.length,
      runConsumer("./reexports/all").diagnostics.length,
      runConsumer("./reexports/namespace").diagnostics.length,
      runConsumer("./reexports/type-named").diagnostics.length,
      runConsumer("./reexports/type-all").diagnostics.length,
    ]).toEqual([1, 1, 1, 0, 0]);
  });

  it("does not suppress a static factory wrapper when the caller activates badMutable", () => {
    writeFile(
      "src/utils/dayjs.ts",
      `import dayjs from"dayjs";import utc from"dayjs/plugin/utc";dayjs.extend(utc);export const utcFactory=dayjs.utc`,
    );
    const source = `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";import{utcFactory}from"./utils/dayjs";import{useState}from"react";dayjs.extend(badMutable);const C=()=>{const[,setDate]=useState({selectedMonth:utcFactory()});setDate(previous=>({...previous,selectedMonth:previous.selectedMonth.add(1,"month")}))}`;
    const result = runRule(noSideEffectInStateUpdaterFunction, source, {
      filename: writeFile("src/component.tsx", source),
    });
    expect(result.diagnostics).toHaveLength(1);
  });
});
