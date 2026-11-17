import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnsafeJsonParse } from "./no-unsafe-json-parse.js";

interface LocalJsonResultCase {
  name: string;
  code: string;
  expectedCount: number;
  options: { filename: string };
}

const cases: LocalJsonResultCase[] = [
  {
    name: "direct-next-member",
    code: "const parsed = JSON.parse(raw); const value = parsed.value;",
    expectedCount: 1,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "next-return-member",
    code: "const read = (raw) => { const parsed = JSON.parse(raw); return parsed.value; };",
    expectedCount: 1,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "next-object-destructure",
    code: "const parsed = JSON.parse(raw); const { value: selected } = parsed;",
    expectedCount: 1,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "next-array-destructure",
    code: "const parsed = JSON.parse(raw); const [selected] = parsed;",
    expectedCount: 1,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "conditional-parse-empty-fallback",
    code: "const read = (enabled, raw) => { const parsed = enabled ? JSON.parse(raw) : {}; const { value } = parsed; };",
    expectedCount: 1,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "alternate-parse-empty-fallback",
    code: "const read = (enabled, raw) => { const parsed = enabled ? {} : JSON.parse(raw); const value = parsed.value; };",
    expectedCount: 1,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "next-if-member-with-later-fields",
    code: "const consume = async (event) => { const parsed = JSON.parse(event.data); if (parsed.answer) { receive(parsed.answer); } else if (parsed.candidate) { receive(parsed.candidate); } };",
    expectedCount: 1,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "typed-local-next-destructure",
    code: "const read = (raw: string) => { const parsed: Record<string,string> = raw ? JSON.parse(raw) : {}; const { title: selected, value: other } = parsed; return selected; };",
    expectedCount: 1,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "transparent-parse-and-read",
    code: "const parsed = JSON.parse(raw) as Record<string,string>; const value = (parsed as Record<string,string>).value;",
    expectedCount: 1,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "static-computed-member",
    code: 'const parsed = JSON.parse(raw); const value = parsed["value"];',
    expectedCount: 1,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "static-computed-parse",
    code: 'const parsed = JSON["parse"](raw); const value = parsed.value;',
    expectedCount: 1,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "next-member-chain",
    code: "const parsed = JSON.parse(raw); const value = parsed.nested.value;",
    expectedCount: 1,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "next-member-expression",
    code: "const parsed = JSON.parse(raw); parsed.value;",
    expectedCount: 1,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "unrelated-static-global-read",
    code: "void window.location; void document.title; const parsed = JSON.parse(raw); const value = parsed.value;",
    expectedCount: 1,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "multiple-independent-locals",
    code: "const first = JSON.parse(raw); const value = first.value; const second = JSON.parse(other); const another = second.value;",
    expectedCount: 2,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "outer-try-does-not-catch-deferred-owner",
    code: "try { queue(() => { const parsed = JSON.parse(raw); return parsed.value; }); } catch {}",
    expectedCount: 1,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "bare-parse-result",
    code: "const parsed = JSON.parse(raw);",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "optional-member-read",
    code: "const parsed = JSON.parse(raw); const value = parsed?.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "null-guard-before-read",
    code: "const parsed = JSON.parse(raw); if (parsed) { consume(parsed.value); }",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "logical-null-guard",
    code: "const parsed = JSON.parse(raw); const value = parsed && parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "schema-validation-transport",
    code: "const parsed = JSON.parse(raw); const selected = schema.parse(parsed); const value = selected.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "unrelated-validation-intervenes",
    code: "const parsed = JSON.parse(raw); validate(other); const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "whole-local-alias",
    code: "const parsed = JSON.parse(raw); const alias = parsed; const value = alias.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "let-reassignment",
    code: "let parsed = JSON.parse(raw); parsed = {}; const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "const-write-invalidates-new-profile",
    code: "const parsed = JSON.parse(raw); const value = parsed.value; parsed = other;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "nested-captured-read",
    code: "const parsed = JSON.parse(raw); const read = () => parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "later-captured-read-declines",
    code: "const parsed = JSON.parse(raw); const value = parsed.value; const later = () => parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "reviver-is-not-modeled",
    code: "const parsed = JSON.parse(raw, revive); const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "nonempty-conditional-fallback",
    code: "const parsed = enabled ? JSON.parse(raw) : { value: 1 }; const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "defaulting-destructure-unsupported",
    code: "const parsed = JSON.parse(raw); const { value = fallback } = parsed;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "dynamic-member-key-unsupported",
    code: "const parsed = JSON.parse(raw); const value = parsed[key];",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "enclosing-try-preserved",
    code: "try { const parsed = JSON.parse(raw); const value = parsed.value; } catch {}",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "static-literal-exception",
    code: 'const parsed = JSON.parse("{}"); const value = parsed.value;',
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "stringify-clone-exception",
    code: "const parsed = JSON.parse(JSON.stringify(value)); const selected = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "shadowed-json-provider",
    code: "const JSON = { parse: (raw) => ({value:1}) }; const parsed = JSON.parse(raw); const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "direct-json-method-replacement",
    code: "JSON.parse = replacement; const parsed = JSON.parse(raw); const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "qualified-json-method-replacement",
    code: "globalThis.JSON.parse = replacement; const parsed = JSON.parse(raw); const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "accessor-json-provider-replacement",
    code: 'Object.defineProperty(globalThis, "JSON", { get: () => replacement }); const parsed = JSON.parse(raw); const value = parsed.value;',
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "whole-json-provider-exposure",
    code: "inspect(JSON); const parsed = JSON.parse(raw); const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "eval-identifier-reference",
    code: "void eval; const parsed = JSON.parse(raw); const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "with-statement-profile",
    code: "with (context) { inspect(value); } const parsed = JSON.parse(raw); const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.cjs",
    },
  },
  {
    name: "runtime-typescript-enum-profile",
    code: "enum Marker { Ready = inspect() } const parsed = JSON.parse(raw); const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "erased-typescript-json-name",
    code: "interface JSON {} const parsed = JSON.parse(raw); const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "type-only-import-json-runtime-use",
    code: 'import type { JSON } from "./types"; const parsed = JSON.parse(raw); const value = parsed.value;',
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "document-window-carrier",
    code: "void document.defaultView; const parsed = JSON.parse(raw); const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "global-self-carrier",
    code: "void window.self; const parsed = JSON.parse(raw); const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "legacy-immediate-provider-policy-unchanged",
    code: "JSON.parse = replacement; const value = JSON.parse(raw).value;",
    expectedCount: 1,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "test-file-policy-unchanged",
    code: "const parsed = JSON.parse(raw); const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.test.tsx",
    },
  },
  {
    name: "literal-unreachable-conditional-parse",
    code: "const parsed = false ? JSON.parse(raw) : {}; const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "parse-after-return-is-unreachable",
    code: "const read = (raw) => { return null; const parsed = JSON.parse(raw); return parsed.value; };",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "truthy-string-skips-parse",
    code: 'const parsed = "ready" ? {} : JSON.parse(raw); const value = parsed.value;',
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "truthy-number-skips-parse",
    code: "const parsed = 1 ? {} : JSON.parse(raw); const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "truthy-regex-skips-parse",
    code: "const parsed = /ready/ ? {} : JSON.parse(raw); const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "falsy-number-skips-parse",
    code: "const parsed = 0 ? JSON.parse(raw) : {}; const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "static-reachable-conditional-outside-profile",
    code: 'const parsed = "ready" ? JSON.parse(raw) : {}; const value = parsed.value;',
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "known-const-true-condition",
    code: "const enabled = true; const parsed = enabled ? {} : JSON.parse(raw); const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "known-let-false-condition",
    code: "let enabled = false; const parsed = enabled ? JSON.parse(raw) : {}; const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "known-global-object-condition",
    code: "const parsed = globalThis ? {} : JSON.parse(raw); const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "const-alias-condition-outside-profile",
    code: "const source = true; const enabled = source; const parsed = enabled ? {} : JSON.parse(raw); const value = parsed.value;",
    expectedCount: 0,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "actual-call-condition-binding",
    code: "const enabled = readFlag(); const parsed = enabled ? JSON.parse(raw) : {}; const value = parsed.value;",
    expectedCount: 1,
    options: {
      filename: "src/view.tsx",
    },
  },
  {
    name: "actual-await-call-condition-binding",
    code: "const read = async (raw) => { const enabled = await readFlag(); const parsed = enabled ? JSON.parse(raw) : {}; const value = parsed.value; };",
    expectedCount: 1,
    options: {
      filename: "src/view.tsx",
    },
  },
];

describe("no-unsafe-json-parse closed local result", () => {
  for (const source of cases) {
    it(source.name, () => {
      const result = runRule(noUnsafeJsonParse, source.code, source.options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(source.expectedCount);
    });
  }
});
