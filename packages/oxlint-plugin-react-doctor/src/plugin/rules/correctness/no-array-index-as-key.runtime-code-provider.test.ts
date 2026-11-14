import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

describe("runtime code providers and local text records", () => {
  it.each([
    [
      'const { createRequire } = require("node:module"); const load = createRequire("/example/app.cjs"); load("vm").runInThisContext("handler => String.prototype.split = handler")(replacement);',
      1,
    ],
    [
      'const { createRequire } = process.getBuiltinModule("module"); const load = createRequire("/example/app.cjs"); load("vm").runInThisContext("handler => String.prototype.split = handler")(replacement);',
      1,
    ],
    [
      'import machine = require("node:vm"); machine.runInThisContext("handler => String.prototype.split = handler")(replacement);',
      1,
    ],
    [
      'import runtime from "node:process"; runtime.getBuiltinModule("vm").runInThisContext("handler => String.prototype.split = handler")(replacement);',
      1,
    ],
    [
      'import { getBuiltinModule as load } from "process"; load("vm").runInThisContext("handler => String.prototype.split = handler")(replacement);',
      1,
    ],
    [
      'const { getBuiltinModule: load } = process; load("vm").runInThisContext("handler => String.prototype.split = handler")(replacement);',
      1,
    ],
    [
      'interface require {} const machine = require("node:vm"); machine.runInThisContext("handler => String.prototype.split = handler")(replacement);',
      1,
    ],
    [
      'interface process {} process.getBuiltinModule("vm").runInThisContext("handler => String.prototype.split = handler")(replacement);',
      1,
    ],
    [
      'const runtime = process; runtime.getBuiltinModule("vm").runInThisContext("handler => String.prototype.split = handler")(replacement);',
      1,
    ],
    [
      'const { process: runtime } = globalThis; runtime.getBuiltinModule("vm").runInThisContext("handler => String.prototype.split = handler")(replacement);',
      1,
    ],
    [
      'const load = require; load("vm").runInThisContext("handler => String.prototype.split = handler")(replacement);',
      1,
    ],
    [
      'import { createRequire } from "node:module"; const load = createRequire(import.meta.url); load("vm").runInThisContext("handler => String.prototype.split = handler")(replacement);',
      1,
    ],
    [
      'module.require("vm").runInThisContext("handler => String.prototype.split = handler")(replacement);',
      1,
    ],
    [
      'const machine = await import("node:vm"); machine.runInThisContext("handler => String.prototype.split = handler")(replacement);',
      1,
    ],
    [
      'import { runInThisContext as execute } from "node:vm"; execute("handler => String.prototype.split = handler")(replacement);',
      1,
    ],
    [
      'import * as machine from "vm"; machine.runInThisContext("handler => String.prototype.split = handler")(replacement);',
      1,
    ],
    [
      'import machine from "node:vm"; machine.runInThisContext("handler => String.prototype.split = handler")(replacement);',
      1,
    ],
    [
      'const machine = require("node:vm"); machine.runInThisContext("handler => String.prototype.split = handler")(replacement);',
      1,
    ],
    [
      'process.getBuiltinModule("vm").runInThisContext("handler => String.prototype.split = handler")(replacement);',
      1,
    ],
    ['import { runInThisContext as execute } from "node:vm";', 0],
    ['import type machine = require("node:vm");', 0],
    [
      'const require = () => ({ runInThisContext: () => () => {} }); require("vm").runInThisContext("handler => String.prototype.split = handler")(replacement);',
      0,
    ],
    [
      'const process = { getBuiltinModule: () => ({ runInThisContext: () => () => {} }) }; interface process {} process.getBuiltinModule("vm").runInThisContext("handler => String.prototype.split = handler")(replacement);',
      0,
    ],
    [
      'const execute = () => () => {}; execute("handler => String.prototype.split = handler")(replacement);',
      0,
    ],
    [
      'import { runInThisContext as execute } from "node:vm"; { const execute = () => () => {}; execute("handler => String.prototype.split = handler")(replacement); }',
      0,
    ],
  ])("checks %s", (before, count) => {
    const result = runRule(
      noArrayIndexAsKey,
      `${before}
export const Tokens = () => [{ text: "red blue" }].map(entry => entry.text.split(" ").map((text, index) => <span key={index}>{text}</span>));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(count);
  });
});
