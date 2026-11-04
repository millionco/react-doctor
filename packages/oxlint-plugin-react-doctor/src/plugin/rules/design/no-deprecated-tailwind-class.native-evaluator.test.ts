import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { noDeprecatedTailwindClass } from "./no-deprecated-tailwind-class.js";

let projectDirectory: string;
const canonical = `import {clsx} from "clsx";import {twMerge} from "tailwind-merge";const cn=(...values)=>twMerge(clsx(values));`;

beforeEach(() => {
  projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "native-class-evaluator-"));
  fs.writeFileSync(
    path.join(projectDirectory, "package.json"),
    JSON.stringify({ dependencies: { clsx: "2.1.1", "tailwind-merge": "3.4.0" } }),
  );
  resetManifestCaches();
});

afterEach(() => fs.rmSync(projectDirectory, { recursive: true, force: true }));

describe("closed merger evaluator native assumptions", () => {
  it.each([
    ["ordinary canonical realm", "", 1],
    [
      "ordinary native calls",
      `Array.isArray([]); Object.keys({ value: 1 }); String(42); Number.isNaN(0);`,
      1,
    ],
    ["native binding replacement", `Array = function() {};`, 0],
    ["native static replacement", `Array.isArray = () => false;`, 0],
    [
      "native const alias replacement",
      `const NativeArray = Array; NativeArray.isArray = () => false;`,
      0,
    ],
    ["browser host native replacement", `document.defaultView.Array.isArray = () => false;`, 0],
    [
      "unknown host native replacement",
      `const host = receiveHost(); host.Array.isArray = () => false;`,
      0,
    ],
    [
      "destructured host native replacement",
      `const { Array: NativeArray } = document.defaultView; NativeArray.isArray = () => false;`,
      0,
    ],
    ["native namespace escape", `inspect(Array);`, 0],
    ["indirect namespace escape", `const carrier = { namespace: Array }; inspect(carrier);`, 0],
    [
      "native reflection replacement",
      `Object.defineProperty(Array, "isArray", { value: () => false });`,
      0,
    ],
    ["string prototype replacement", `String.prototype.trim = () => "";`, 0],
    ["array prototype replacement", `Array.prototype.indexOf = () => 0;`, 0],
    ["map prototype replacement", `Map.prototype.get = () => "";`, 0],
    ["number validator replacement", `Number.isInteger = () => true;`, 0],
    ["regexp prototype replacement", `RegExp.prototype.test = () => false;`, 0],
    ["implicit prototype access", `[].constructor.prototype.indexOf = () => 0;`, 0],
    ["host dynamic code", `globalThis.eval("Array.isArray = () => false");`, 0],
    ["host constructor code", `globalThis.Function("Array.isArray = () => false")();`, 0],
    ["computed reflection", `const key = "constructor"; [][key].prototype.indexOf = () => 0;`, 0],
    ["opaque computed access", `const receiver = getReceiver(); receiver[key];`, 0],
    [
      "unproven split result receiver",
      `const read = (input) => { const fragments = input.split(":"); return fragments[0]; };`,
      0,
    ],
    [
      "unproven collection receiver",
      `const read = () => { const choices = fetchChoices(); return choices[0]; };`,
      0,
    ],
    [
      "unproven chained receiver",
      `const read = (input) => input.split("::").pop()?.split("|")[0];`,
      0,
    ],
    [
      "hidden host write",
      `try { throw {}; } catch ({ unused = (globalThis.Array.isArray = () => false) }) {}`,
      0,
    ],
    [
      "parameter bodyvar ambiguity",
      `function change(unused = (Array.isArray = () => false)) { var Array; } change();`,
      0,
    ],
    [
      "parameter alias ambiguity",
      `const NativeArray = Array; function change(unused = (NativeArray.isArray = () => false)) { var NativeArray; } change();`,
      0,
    ],
    [
      "parameter host alias ambiguity",
      `const Host = globalThis; function change(unused = (Host.Array.isArray = () => false)) { var Host; } change();`,
      0,
    ],
    [
      "nested default closure ambiguity",
      `const NativeArray = Array; function change(unused = () => (NativeArray.isArray = () => false)) { var NativeArray; unused(); } change();`,
      0,
    ],
    ["literal parameter default", `function harmless(value = 42) { return value; } harmless();`, 1],
  ])("%s", (_name, prefix, count) => {
    const code = `${canonical} ${prefix} const View=()=> <div className={cn("bg-gradient-to-r")} />;`;
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: path.join(projectDirectory, "view.tsx"),
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(count);
  });

  it.each([
    ["", 1],
    ["Array.isArray = () => false;", 0],
  ])("checks native assumptions in the imported wrapper program %s", (mutation, count) => {
    fs.writeFileSync(
      path.join(projectDirectory, "classes.ts"),
      `${canonical} ${mutation} export { cn };`,
    );
    const code = `import {cn} from "./classes"; const View=()=> <div className={cn("bg-gradient-to-r")} />;`;
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: path.join(projectDirectory, "view.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(count);
  });
});
