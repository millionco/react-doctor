import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
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

describe("no-side-effect-in-state-updater-function cross-file Day.js wrappers", () => {
  it("keeps a wrapper that only activates an immutable Day.js plugin quiet", () => {
    writeFile(
      "src/utils/dayjs.ts",
      `import dayjs from"dayjs";import customParseFormat from"dayjs/plugin/customParseFormat";dayjs.extend(customParseFormat);export default dayjs`,
    );
    expect(runConsumer("./utils/dayjs").diagnostics).toHaveLength(0);
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
