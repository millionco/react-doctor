import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayFindResultMemberAccessWithoutGuard } from "./no-array-find-result-member-access-without-guard.js";

const cases = [
  {
    name: "inline-captured-counter-guard-can-miss",
    code: 'export const read = () => {\n  const rows = [{ label: "only" }];\n  let calls = 0;\n  if (rows.some(() => ++calls === 1)) return rows.find(() => ++calls === 1).label;\n  return "none";\n};\n',
    diagnosticCount: 1,
  },
  {
    name: "inline-captured-assignment-toggle",
    code: 'export const read = () => {\n  const rows = [{ label: "only" }];\n  let phase = false;\n  if (rows.some(() => (phase = !phase))) return rows.find(() => (phase = !phase)).label;\n  return "none";\n};\n',
    diagnosticCount: 1,
  },
  {
    name: "readonly-function-with-captured-counter",
    code: 'export const read = () => {\n  const rows = [{ label: "only" }];\n  let calls = 0;\n  const isReady = () => ++calls === 1;\n  if (rows.some(isReady)) return rows.find(isReady).label;\n  return "none";\n};\n',
    diagnosticCount: 1,
  },
  {
    name: "pure-predicate-guard",
    code: 'export const read = () => {\n  const rows = [{ label: "only", enabled: true }];\n  if (rows.some((row) => row.enabled)) return rows.find((row) => row.enabled).label;\n  return "none";\n};\n',
    diagnosticCount: 0,
  },
  {
    name: "fresh-callback-local-mutation",
    code: 'export const read = () => {\n  const rows = [{ label: "only", enabled: true }];\n  if (rows.some((row) => { let local = 0; local++; return row.enabled; })) return rows.find((row) => { let local = 0; local++; return row.enabled; }).label;\n  return "none";\n};\n',
    diagnosticCount: 0,
  },
  {
    name: "captured-bookkeeping-does-not-change-returned-field",
    code: 'export const read = () => {\n  const rows = [{ label: "only", enabled: true }];\n  let calls = 0;\n  if (rows.some((row) => { calls++; return row.enabled; })) return rows.find((row) => { calls++; return row.enabled; }).label;\n  return "none";\n};\n',
    diagnosticCount: 0,
  },
  {
    name: "captured-bookkeeping-with-constant-true-return",
    code: 'export const read = () => {\n  const rows = [{ label: "only", enabled: true }];\n  let calls = 0;\n  if (rows.some(() => { calls++; return true; })) return rows.find(() => { calls++; return true; }).label;\n  return "none";\n};\n',
    diagnosticCount: 0,
  },
  {
    name: "custom-native-array-find-always-returns-object",
    code: "export const read = () => { const rows = [{label:'only'}]; rows.find = () => ({label:'safe'}); let calls=0; if(rows.some(() => ++calls === 1)) return rows.find(() => ++calls === 1).label; return 'none'; };",
    diagnosticCount: 0,
  },
  {
    name: "captured-monotone-output-remains-true",
    code: "export const read = () => { const rows = [{label:'only'}]; let calls=0; if(rows.some(() => ++calls > 0)) return rows.find(() => ++calls > 0).label; return 'none'; };",
    diagnosticCount: 0,
  },
  {
    name: "two-item-toggle-is-safe",
    code: 'export const read = () => { const rows = [{label:"first"}, {label:"second"}]; let phase = false; if (rows.some(() => (phase = !phase))) return rows.find(() => (phase = !phase)).label; return "none"; };',
    diagnosticCount: 0,
  },
  {
    name: "single-spread-element-can-expand-to-two-items",
    code: 'export const read = () => { const rows = [...[{label:"first"}, {label:"second"}]]; let phase = false; if (rows.some(() => (phase = !phase))) return rows.find(() => (phase = !phase)).label; return "none"; };',
    diagnosticCount: 0,
  },
  {
    name: "explicit-reset-before-find-is-safe",
    code: 'export const read = () => { const rows = [{label:"only"}]; let calls = 0; if (rows.some(() => ++calls === 1)) { calls = 0; return rows.find(() => ++calls === 1).label; } return "none"; };',
    diagnosticCount: 0,
  },
  {
    name: "named-reset-in-intervening-call-is-safe",
    code: 'export const read = () => { const rows = [{label:"only"}]; let calls = 0; const reset = () => { calls = 0; }; if (rows.some(() => ++calls === 1)) { reset(); return rows.find(() => ++calls === 1).label; } return "none"; };',
    diagnosticCount: 0,
  },
  {
    name: "same-spelling-different-symbols-is-safe",
    code: 'export const read = () => { const rows = [{label:"only"}]; let calls = 0; if (rows.some(() => ++calls === 1)) { let calls = 0; return rows.find(() => ++calls === 1).label; } return "none"; };',
    diagnosticCount: 0,
  },
  {
    name: "custom-some-can-leave-toggle-untouched",
    code: 'export const read = () => { const rows = [{label:"only"}]; rows.some = () => true; let phase = false; if (rows.some(() => (phase = !phase))) return rows.find(() => (phase = !phase)).label; return "none"; };',
    diagnosticCount: 0,
  },
  {
    name: "callback-parameter-initializer-is-runtime",
    code: 'export const read = () => { const rows = [{label:"only"}]; let calls = 0; if (rows.some((row, index = (calls = 0)) => ++calls === 1)) return rows.find((row, index = (calls = 0)) => ++calls === 1).label; return "none"; };',
    diagnosticCount: 0,
  },
  {
    name: "counter changes between repeated find calls",
    code: 'export const read = () => { const rows = [{ label: "only" }]; let calls = 0; if (rows.find(() => ++calls === 1)) return rows.find(() => ++calls === 1).label; return "none"; };',
    diagnosticCount: 1,
  },
  {
    name: "named counter changes after findIndex before findLast",
    code: 'export const read = () => { const rows = [{ label: "only" }]; let calls = 0; const isReady = () => ++calls === 1; if (rows.findIndex(isReady) !== -1) return rows.findLast(isReady).label; return "none"; };',
    diagnosticCount: 1,
  },
  {
    name: "toggle changes between repeated findLast calls",
    code: 'export const read = () => { const rows = [{ label: "only" }]; let phase = false; if (rows.findLast(() => (phase = !phase))) return rows.findLast(() => (phase = !phase)).label; return "none"; };',
    diagnosticCount: 1,
  },
  {
    name: "ambient-const-Function-runtime-provider",
    code: 'declare const Function: FunctionConstructor;\nFunction("Array.prototype.find = () => ({label: \'safe\'})")();\nexport const read = () => { const rows = [{label:"only"}]; let calls=0; if(rows.some(() => ++calls === 1)) return rows.find(() => ++calls === 1).label; return "none"; };',
    diagnosticCount: 0,
  },
  {
    name: "ambient-function-Function-runtime-provider",
    code: 'declare function Function(...arguments_: string[]): Function;\nFunction("Array.prototype.find = () => ({label: \'safe\'})")();\nexport const read = () => { const rows = [{label:"only"}]; let calls=0; if(rows.some(() => ++calls === 1)) return rows.find(() => ++calls === 1).label; return "none"; };',
    diagnosticCount: 0,
  },
];

describe("repeated native lookup predicates", () => {
  it.each(cases)("$name", ({ code, diagnosticCount }) => {
    const result = runRule(noArrayFindResultMemberAccessWithoutGuard, code, {
      filename: "repeated-native-lookup.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });
});
