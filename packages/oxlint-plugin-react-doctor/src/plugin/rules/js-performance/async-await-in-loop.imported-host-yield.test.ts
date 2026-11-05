import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { asyncAwaitInLoop } from "./async-await-in-loop.js";

const nativeTimeout =
  "export async function timeout(delay = 0) { await new Promise((resolve) => { setTimeout(() => resolve(), delay); }); }";

describe("async-await-in-loop imported host yields", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-host-yield-"));
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  const writeFile = (relativePath: string, source: string): string => {
    const filename = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, source);
    return filename;
  };

  const run = (extraLoopWork = "", prelude = "", exportedName = "timeout") => {
    const code = [
      `import { ${exportedName} as waitForChunk } from "./scheduler";`,
      prelude,
      "export async function filterRows(rows) {",
      "  for (const row of rows) {",
      "    inspect(row);",
      "    await waitForChunk();",
      extraLoopWork,
      "  }",
      "}",
    ].join("\n");
    const filename = writeFile("filter.ts", code);
    const result = runRule(asyncAwaitInLoop, code, { filename, includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    return result.diagnostics;
  };

  it("skips a proven timer yield and still reports the next unrelated await", () => {
    writeFile("scheduler/index.ts", nativeTimeout);
    expect(run()).toEqual([]);
    const diagnostics = run("    await request(row);");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.line).toBe(7);
  });

  it("uses the direct export's body rather than the export or import name", () => {
    writeFile("scheduler/index.ts", nativeTimeout.replace("timeout", "deferToBrowser"));
    expect(run("", "", "deferToBrowser")).toEqual([]);
  });

  it("invalidates an accepted provider when its source changes", () => {
    writeFile("scheduler/index.ts", nativeTimeout);
    expect(run()).toEqual([]);
    writeFile(
      "scheduler/index.ts",
      "export async function timeout(delay = 0) { await Promise.resolve(delay); }",
    );
    expect(run()).toHaveLength(1);
  });

  it.each([
    ["shadowed scheduler", "const setTimeout = (callback) => callback();"],
    ["shadowed Promise", "class Promise {}"],
    ["ambient scheduler override", "globalThis.setTimeout = replacement;"],
    ["ambient scheduler escape", "save(setTimeout);"],
  ])("retains the warning for a %s", (_name, providerPrelude) => {
    writeFile("scheduler/index.ts", `${providerPrelude}\n${nativeTimeout}`);
    expect(run()).toHaveLength(1);
  });

  it.each([
    "setTimeout(() => {}, delay); resolve();",
    "setTimeout(() => resolve(), delay); save(resolve);",
    "setTimeout(() => save(resolve), delay);",
    "setTimeout(() => anotherResolver(), delay);",
    "setTimeout(() => resolve(), 5);",
  ])("requires the actual resolver to be called only by the timer: %s", (executorBody) => {
    writeFile(
      "scheduler/index.ts",
      `export async function timeout(delay = 0) { await new Promise((resolve) => { ${executorBody} }); }`,
    );
    expect(run()).toHaveLength(1);
  });

  it("retains the warning when the import escapes or a visible write replaces Promise", () => {
    writeFile("scheduler/index.ts", nativeTimeout);
    expect(run("", "save(waitForChunk);")).toHaveLength(1);
    expect(run("", "globalThis.Promise = replacement;")).toHaveLength(1);
  });

  it.each([
    "document.defaultView.setTimeout = (callback) => callback();",
    "const { defaultView: realm } = document; realm.setTimeout = replacement;",
    "(async () => {})().constructor.prototype.then = replacement;",
    "const { constructor: PromiseConstructor } = (async () => {})(); PromiseConstructor.prototype.then = replacement;",
    "const prototype = Object.getPrototypeOf((async () => {})()); prototype.then = replacement;",
    "(async () => {})().__proto__.__defineGetter__('then', replacement);",
  ])("retains warnings when a visible gateway can replace the native behavior: %s", (prelude) => {
    writeFile("scheduler/index.ts", nativeTimeout);
    expect(run("", prelude)).toHaveLength(1);
  });

  it("allows a separate helper reflecting on its own constructor parameter", () => {
    writeFile(
      "scheduler/index.ts",
      `export function applyMixins(derivedCtor, source) {
        Object.defineProperty(derivedCtor.prototype, source.name, source.descriptor);
      }
      ${nativeTimeout}`,
    );
    expect(run()).toEqual([]);
  });

  it("does not follow re-exports", () => {
    writeFile("scheduler/index.ts", 'export { timeout } from "./implementation";');
    writeFile("scheduler/implementation.ts", nativeTimeout);
    expect(run()).toHaveLength(1);
  });

  it("does not choose between competing source files", () => {
    writeFile("scheduler/index.ts", nativeTimeout);
    writeFile("scheduler.ts", nativeTimeout);
    expect(run()).toHaveLength(1);
  });
});
