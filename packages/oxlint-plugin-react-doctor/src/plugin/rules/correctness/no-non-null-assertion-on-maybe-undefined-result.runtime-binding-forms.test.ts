import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNonNullAssertionOnMaybeUndefinedResult } from "./no-non-null-assertion-on-maybe-undefined-result.js";

const scenarios = [
  {
    name: "native baseline",
    code: 'const groups = new Map(); const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 0,
  },
  {
    name: "genuine local value",
    code: 'const globalThis = { note: 0 };globalThis.note = 1;const groups = new Map(); const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 0,
  },
  {
    name: "interface after genuine local value",
    code: 'const globalThis = { note: 0 };interface globalThis {}globalThis.note = 1;const groups = new Map(); const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 0,
  },
  {
    name: "interface before genuine local value",
    code: 'interface globalThis {}const globalThis = { note: 0 };globalThis.note = 1;const groups = new Map(); const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 0,
  },
  {
    name: "inner interface preserves outer runtime value",
    code: 'const globalThis = { note: 0 };const inspectProvider = () => { interface globalThis {} globalThis.note = 1; };const groups = new Map(); const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 0,
  },
  {
    name: "type-only import equals cannot mask runtime mutation",
    code: 'import type globalThis = require("provider-types");globalThis.Map.prototype.get = () => undefined;const groups = new Map(); const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 1,
  },
  {
    name: "erased namespace cannot mask mutation: namespace globalThis {}",
    code: 'namespace globalThis {}globalThis.Map.prototype.get = () => undefined;const groups = new Map(); const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 1,
  },
  {
    name: "erased namespace cannot mask mutation: namespace globalThis { export interface Marker {} }",
    code: 'namespace globalThis { export interface Marker {} }globalThis.Map.prototype.get = () => undefined;const groups = new Map(); const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 1,
  },
  {
    name: "erased namespace cannot mask mutation: namespace globalThis { export namespace Nested { export interface Marker {} } }",
    code: 'namespace globalThis { export namespace Nested { export interface Marker {} } }globalThis.Map.prototype.get = () => undefined;const groups = new Map(); const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 1,
  },
];
const options = {
  filename: "src/binding-forms.tsx",
  forceJsx: true,
};

describe("runtime and type binding namespaces", () => {
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const result = runRule(noNonNullAssertionOnMaybeUndefinedResult, scenario.code, options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
