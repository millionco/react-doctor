import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsHoistRegexp } from "./js-hoist-regexp.js";

const expectFail = (...codeSamples: string[]): void => {
  for (const code of codeSamples) {
    const result = runRule(jsHoistRegexp, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  }
};

const expectPass = (...codeSamples: string[]): void => {
  for (const code of codeSamples) {
    const result = runRule(jsHoistRegexp, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  }
};

describe("js-performance/js-hoist-regexp — regressions", () => {
  it("flags a static-pattern `new RegExp(...)` built inside a loop", () => {
    expectFail(`for (const line of lines) { const m = new RegExp("\\\\d+", "i"); m.test(line); }`);
  });

  it("does not flag a global RegExp whose lastIndex resets on every loop pass", () => {
    expectPass(`for (const line of lines) { const m = new RegExp("\\\\d+", "g"); m.test(line); }`);
  });

  it("does not flag global or sticky flag combinations", () => {
    for (const flags of ["g", "y", "gi", "my", "dgy"]) {
      expectPass(`for (const line of lines) { new RegExp("a", "${flags}").test(line); }`);
    }
  });

  it("does not flag stateful static template flags for call or constructor forms", () => {
    expectPass(
      `for (const line of lines) { RegExp("a", \`g\`).test(line); }`,
      `for (const line of lines) { new RegExp(\`a\`, \`y\`).test(line); }`,
    );
  });

  it("flags global RegExp construction passed directly to native string replaceAll", () => {
    expectFail(
      `function f(text: string, values: string[]) { for (const value of values) { text.replaceAll(new RegExp("a", "g"), value); } }`,
      `for (const value of values) { "aba".replaceAll(RegExp("a", "gy"), value); }`,
    );
  });

  it("proves globSync iteration values are native strings", () => {
    expectFail(
      `import { globSync } from "glob"; for (const file of globSync("**/*.js", { nodir: true })) { file.replaceAll(new RegExp(/(group)\\//gm), ""); }`,
      `import { globSync as findFiles } from "glob"; for (const file of findFiles("**/*.js")) { const path = file; path.replaceAll((new RegExp("a", "gy") as RegExp), ""); }`,
      `import * as glob from "glob"; for (const file of glob.globSync("**/*.js", { withFileTypes: false })) { file.replaceAll(new RegExp("a", "g"), ""); }`,
    );
  });

  it("stays quiet when replaceAll receiver provenance is not native string", () => {
    expectPass(
      `class Text { replaceAll(search, replacement) { return replacement; } } const text = new Text(); for (const value of values) { text.replaceAll(new RegExp("a", "g"), value); }`,
      `function f(text, values) { for (const value of values) { text.replaceAll(new RegExp("a", "g"), value); } }`,
      `function globSync() { return customValues; } for (const file of globSync()) { file.replaceAll(new RegExp("a", "g"), ""); }`,
      `import { globSync } from "custom-glob"; for (const file of globSync()) { file.replaceAll(new RegExp("a", "g"), ""); }`,
    );
  });

  it("requires globSync options to preserve string return values", () => {
    expectPass(
      `import { globSync } from "glob"; for (const file of globSync("**", { withFileTypes: true })) { file.replaceAll(new RegExp("a", "g"), ""); }`,
      `import { globSync } from "glob"; for (const file of globSync("**", options)) { file.replaceAll(new RegExp("a", "g"), ""); }`,
      `import { globSync } from "glob"; for (const file of globSync("**", { ...options })) { file.replaceAll(new RegExp("a", "g"), ""); }`,
    );
  });

  it("requires a direct replaceAll search argument with globally valid flags", () => {
    expectPass(
      `function f(text: string, values: string[]) { for (const value of values) { text.replaceAll(wrap(new RegExp("a", "g")), value); } }`,
      `function f(text: string, values: string[]) { for (const value of values) { text.replaceAll("a", new RegExp("a", "g")); } }`,
      `function f(text: string, values: string[]) { for (const value of values) { text.replaceAll(new RegExp("a", "y"), value); } }`,
      `function f(text: string, values: string[]) { for (const value of values) { text["replaceAll"](new RegExp("a", "g"), value); } }`,
    );
  });

  it("preserves global RegExp reassignment safeguards in replaceAll", () => {
    expectPass(
      `globalThis.RegExp = CustomRegExp; for (const value of values) { "aba".replaceAll(new RegExp("a", "g"), value); }`,
    );
  });

  it("stays quiet when native replaceAll or RegExp replacement hooks are mutated", () => {
    expectPass(
      `String.prototype.replaceAll = customReplaceAll; for (const value of values) { "aba".replaceAll(new RegExp("a", "g"), value); }`,
      `Object.defineProperty(String.prototype, "replaceAll", { value: customReplaceAll }); for (const value of values) { "aba".replaceAll(new RegExp("a", "g"), value); }`,
      `RegExp.prototype.exec = customExec; for (const value of values) { "aba".replaceAll(new RegExp("a", "g"), value); }`,
      `RegExp.prototype[Symbol.replace] = customReplace; for (const value of values) { "aba".replaceAll(new RegExp("a", "g"), value); }`,
      `Object.defineProperty(RegExp.prototype, "exec", { value: customExec }); for (const value of values) { "aba".replaceAll(new RegExp("a", "g"), value); }`,
      `Object.assign(String.prototype, { replaceAll: customReplaceAll }); for (const value of values) { "aba".replaceAll(new RegExp("a", "g"), value); }`,
      `Reflect.set(RegExp.prototype, "exec", customExec); for (const value of values) { "aba".replaceAll(new RegExp("a", "g"), value); }`,
    );
  });

  it("follows stable aliases when checking native prototype integrity", () => {
    expectPass(
      `const stringPrototype = String.prototype; const prototypeAlias = stringPrototype; prototypeAlias.replaceAll = customReplaceAll; for (const value of values) { "aba".replaceAll(new RegExp("a", "g"), value); }`,
      `const define = Object.defineProperty; const regexpPrototype = RegExp.prototype; define(regexpPrototype, "exec", { value: customExec }); for (const value of values) { "aba".replaceAll(new RegExp("a", "g"), value); }`,
    );
  });

  it("keeps flagging stateless constructions when replaceAll or prototype hooks are mutated", () => {
    expectFail(
      `String.prototype.replaceAll = customReplaceAll; for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `Object.defineProperty(String.prototype, "replaceAll", { value: customReplaceAll }); for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `RegExp.prototype.exec = customExec; for (const line of lines) { new RegExp("a", "i").test(line); }`,
    );
  });

  it("suppresses only the replaceAll carve-out when replaceAll hooks are mutated", () => {
    const result = runRule(
      jsHoistRegexp,
      `String.prototype.replaceAll = customReplaceAll; for (const value of values) { "aba".replaceAll(new RegExp("a", "g"), value); new RegExp("b", "i").test(value); }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps reporting for unrelated or userland prototype mutations", () => {
    expectFail(
      `String.prototype.trim = customTrim; for (const value of values) { "aba".replaceAll(new RegExp("a", "g"), value); }`,
      `Object.assign(String.prototype, { trim: customTrim }); for (const value of values) { "aba".replaceAll(new RegExp("a", "g"), value); }`,
      `class CustomString {} CustomString.prototype.replaceAll = customReplaceAll; for (const value of values) { "aba".replaceAll(new RegExp("a", "g"), value); }`,
      `class CustomRegExp {} CustomRegExp.prototype.exec = customExec; for (const value of values) { "aba".replaceAll(new RegExp("a", "g"), value); }`,
    );
  });

  it("still flags stateless call and constructor forms", () => {
    expectFail(
      `for (const line of lines) { RegExp("a", "i").test(line); }`,
      `for (const line of lines) { new RegExp("a", "m").test(line); }`,
      `for (const line of lines) { new RegExp("a", "").test(line); }`,
    );
  });

  it("does not recommend moving constructors that throw for invalid static flags", () => {
    expectPass(
      `for (const line of lines) { new RegExp("a", "gg").test(line); }`,
      `for (const line of lines) { new RegExp("a", "ii").test(line); }`,
      `for (const line of lines) { new RegExp("a", "q").test(line); }`,
      `for (const line of lines) { new RegExp("a", "uv").test(line); }`,
    );
  });

  it("uses inherited RegExp literal flags when constructor flags are omitted", () => {
    expectPass(
      `for (const line of lines) { new RegExp(/a/g).test(line); }`,
      `for (const line of lines) { RegExp(/a/y).test(line); }`,
    );
  });

  it("uses explicit constructor flags instead of RegExp literal flags", () => {
    expectFail(
      `for (const line of lines) { new RegExp(/a/g, "i").test(line); }`,
      `for (const line of lines) { RegExp(/a/y, "").test(line); }`,
    );
    expectPass(`for (const line of lines) { new RegExp(/a/i, "g").test(line); }`);
  });

  it("resolves transparent wrappers around the constructor and its arguments", () => {
    expectPass(
      `for (const line of lines) { (RegExp as typeof RegExp)(("a" as string), ("g" as string)).test(line); }`,
      `for (const line of lines) { new RegExp((/a/g as RegExp)).test(line); }`,
    );
    expectFail(
      `for (const line of lines) { new (RegExp as typeof RegExp)(("a" as string), ("i" as string)).test(line); }`,
    );
  });

  it("does not assign global RegExp semantics to shadowed or reassigned bindings", () => {
    expectPass(
      `const CustomRegExp = class {}; let RegExp = CustomRegExp; RegExp = CustomRegExp; for (const line of lines) { new RegExp("a", "i"); }`,
      `const scan = (RegExp) => { for (const line of lines) { return RegExp("a", "i"); } };`,
      `RegExp = CustomRegExp; for (const line of lines) { new RegExp("a", "i").test(line); }`,
    );
  });

  it("does not assign global RegExp semantics after global-object member reassignment", () => {
    expectPass(
      `globalThis.RegExp = CustomRegExp; for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `window["RegExp"] = CustomRegExp; for (const line of lines) { RegExp("a", "m").test(line); }`,
      `self[\`RegExp\`] = CustomRegExp; for (const line of lines) { new RegExp("a").test(line); }`,
      `global.RegExp = CustomRegExp; for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `globalThis.globalThis.RegExp = CustomRegExp; for (const line of lines) { new RegExp("a", "i").test(line); }`,
    );
  });

  it("follows stable aliases of the global object", () => {
    expectPass(
      `const root = globalThis; root.RegExp = CustomRegExp; for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `const root = globalThis; const realm = root; realm["RegExp"] = CustomRegExp; for (const line of lines) { RegExp("a", "m").test(line); }`,
    );
  });

  it("recognizes global built-in mutation APIs", () => {
    expectPass(
      `Object.defineProperty(globalThis, "RegExp", { value: CustomRegExp }); for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `Reflect.set(globalThis, "RegExp", CustomRegExp); for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `Object.assign(globalThis, { RegExp: CustomRegExp }); for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `Object.assign(globalThis, getGlobalOverrides()); for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `globalThis.Object.defineProperty(globalThis, "RegExp", { value: CustomRegExp }); for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `globalThis.Reflect.set(globalThis, "RegExp", CustomRegExp); for (const line of lines) { new RegExp("a", "i").test(line); }`,
    );
  });

  it("follows stable aliases of global mutation APIs", () => {
    expectPass(
      `const objectApi = Object; objectApi.defineProperty(globalThis, "RegExp", { value: CustomRegExp }); for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `const define = Object.defineProperty; define(globalThis, "RegExp", { value: CustomRegExp }); for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `const { defineProperty: define } = Object; define(globalThis, "RegExp", { value: CustomRegExp }); for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `const reflectApi = globalThis.Reflect; const set = reflectApi.set; set(globalThis, "RegExp", CustomRegExp); for (const line of lines) { new RegExp("a", "i").test(line); }`,
    );
  });

  it("conservatively handles dynamic writes through proven global objects", () => {
    expectPass(
      `globalThis[getGlobalName()] = CustomRegExp; for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `(globalThis as typeof globalThis)["RegExp"] = CustomRegExp; for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `delete globalThis.RegExp; for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `globalThis.RegExp++; for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `for (globalThis.RegExp of constructors) break; for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `({ value: globalThis.RegExp } = source); for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `[...globalThis.RegExp] = source; for (const line of lines) { new RegExp("a", "i").test(line); }`,
    );
  });

  it("still reports when global-object writes cannot replace the built-in RegExp", () => {
    expectFail(
      `globalThis.fetch = customFetch; for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `globalThis.RegExp.metadata = value; for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `const globalThis = { RegExp: CustomRegExp }; globalThis.RegExp = CustomRegExp; for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `const window = { RegExp: CustomRegExp }; window["RegExp"] = CustomRegExp; for (const line of lines) { RegExp("a", "m").test(line); }`,
      `let root = globalThis; root = customRoot; root.RegExp = CustomRegExp; for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `const global = { RegExp: CustomRegExp }; global.RegExp = CustomRegExp; for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `Object.defineProperty(globalThis, "fetch", { value: customFetch }); for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `Object.assign(globalThis, { fetch: customFetch }); for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `const Object = customObject; Object.defineProperty(globalThis, "RegExp", { value: CustomRegExp }); for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `const Reflect = customReflect; Reflect.set(globalThis, "RegExp", CustomRegExp); for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `let objectApi = Object; objectApi = customObject; objectApi.defineProperty(globalThis, "RegExp", { value: CustomRegExp }); for (const line of lines) { new RegExp("a", "i").test(line); }`,
      `const globalThis = customGlobal; globalThis.Object.defineProperty(globalThis, "RegExp", { value: CustomRegExp }); for (const line of lines) { new RegExp("a", "i").test(line); }`,
    );
  });

  it("stays quiet on stateful constructors across loop and callback control flow", () => {
    expectPass(
      `while (queue.length > 0) { new RegExp("a", "g").test(queue.pop()); }`,
      `const matches = lines.map((line) => new RegExp("a", "y").test(line));`,
      `for (;;) { if (condition) break; RegExp("a", "gy").test(value); }`,
    );
  });

  it("does not flag `new RegExp(loopVar, ...)` whose pattern depends on the loop", () => {
    expectPass(
      `function h(text, kws){ let o=text; for(const k of kws){ const m=new RegExp(k,"gi"); o=o.replace(m,(x)=>x);} return o; }`,
    );
  });

  // fp-review PR #994: the static check must cover the flags argument too.
  it("does not flag a static pattern with loop-variant flags", () => {
    expectPass(
      `for (const flags of flagVariants) { const re = new RegExp("token", flags); re.test(input); }`,
    );
  });

  it("does not flag a template-literal pattern interpolating the loop variable", () => {
    expectPass(
      `function findUsages(componentNames, content, results, importPath) {
  for (const componentName of componentNames) {
    if (new RegExp(\`<\${componentName}\\\\b\`).test(content)) {
      results.push({ componentName, importPath });
    }
  }
}`,
    );
  });

  it("still flags a static pattern in a for-of loop", () => {
    expectFail(`for (const line of lines) { if (new RegExp("^\\\\s*#").test(line)) count++; }`);
  });

  it("still flags an expression-free template-literal pattern with non-stateful flags", () => {
    expectFail(
      `while (queue.length > 0) { const item = queue.pop(); new RegExp(\`abc\`, "m").test(item); }`,
    );
  });

  it("does not flag a no-argument `new RegExp()` in a loop", () => {
    expectPass(`for (const x of xs) { const re = new RegExp(); }`);
  });

  // fn-mining sweep: `RegExp(...)` without `new` constructs a regex per
  // pass exactly like `new RegExp(...)` does.
  it("flags `RegExp(...)` called without `new` inside a for loop", () => {
    expectFail(
      `function count(lines) { let total = 0; for (const line of lines) { if (RegExp("^\\\\d+:").test(line)) total += 1; } return total; }`,
    );
  });

  it("does not flag a non-new `RegExp(loopVar)` whose pattern depends on the loop", () => {
    expectPass(
      `for (const keyword of keywords) { if (RegExp(keyword, "gi").test(text)) hits.push(keyword); }`,
    );
  });

  // fn-mining sweep: iterator callbacks run once per element — regex
  // construction there is per-pass work just like a `for` body.
  it("flags `new RegExp` inside a .map() callback", () => {
    expectFail(`const stripped = lines.map((line) => line.replace(new RegExp("^\\\\d+:"), ""));`);
  });

  it("does not flag `new RegExp` outside any loop or iterator callback", () => {
    expectPass(`const parse = (line) => new RegExp("^\\\\d+:").test(line);`);
  });
});
