import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnsafeJsonParse } from "./no-unsafe-json-parse.js";

interface LocalJsonMethodCase {
  name: string;
  code: string;
  expectedCount: number;
  filename: string;
}

const cases: LocalJsonMethodCase[] = [
  {
    name: "next-variable-method",
    code: "const parsed = JSON.parse(raw); const selected = parsed.find(predicate);",
    expectedCount: 1,
    filename: "src/result-view.tsx",
  },
  {
    name: "next-return-method",
    code: "const select = (raw) => { const parsed = JSON.parse(raw); return parsed.find(predicate); };",
    expectedCount: 1,
    filename: "src/result-view.tsx",
  },
  {
    name: "next-if-method",
    code: "const parsed = JSON.parse(raw); if (parsed.find(predicate)) receive();",
    expectedCount: 1,
    filename: "src/result-view.tsx",
  },
  {
    name: "next-expression-method",
    code: "const parsed = JSON.parse(raw); parsed.find(predicate);",
    expectedCount: 1,
    filename: "src/result-view.tsx",
  },
  {
    name: "static-computed-method",
    code: 'const parsed = JSON.parse(raw); const selected = parsed["find"](predicate);',
    expectedCount: 1,
    filename: "src/result-view.tsx",
  },
  {
    name: "static-nested-member-method",
    code: "const parsed = JSON.parse(raw); const selected = parsed.items.find(predicate);",
    expectedCount: 1,
    filename: "src/result-view.tsx",
  },
  {
    name: "parenthesized-method",
    code: "const parsed = JSON.parse(raw); const selected = ((parsed).find)(predicate);",
    expectedCount: 1,
    filename: "src/result-view.tsx",
  },
  {
    name: "typescript-receiver-wrapper",
    code: "const parsed = JSON.parse(raw); const selected = (parsed as unknown[]).find(predicate);",
    expectedCount: 1,
    filename: "src/result-view.tsx",
  },
  {
    name: "typescript-terminal-wrapper",
    code: "const parsed = JSON.parse(raw); const selected = (parsed.find(predicate) as unknown);",
    expectedCount: 1,
    filename: "src/result-view.tsx",
  },
  {
    name: "non-null-receiver-wrapper",
    code: "const parsed = JSON.parse(raw); const selected = parsed!.find(predicate);",
    expectedCount: 1,
    filename: "src/result-view.tsx",
  },
  {
    name: "conditional-empty-fallback-method",
    code: "const select = (enabled, raw) => { const parsed = enabled ? JSON.parse(raw) : {}; return parsed.find(predicate); };",
    expectedCount: 1,
    filename: "src/result-view.tsx",
  },
  {
    name: "mutating-terminal-method-is-still-consumption",
    code: "const parsed = JSON.parse(raw); parsed.push(value);",
    expectedCount: 1,
    filename: "src/result-view.tsx",
  },
  {
    name: "outer-try-does-not-catch-deferred-method",
    code: "try { queue(() => { const parsed = JSON.parse(raw); return parsed.find(predicate); }); } catch {}",
    expectedCount: 1,
    filename: "src/result-view.tsx",
  },
  {
    name: "malformed-literal-remains-warning",
    code: 'const parsed = JSON.parse("not-json"); const selected = parsed.find(predicate);',
    expectedCount: 1,
    filename: "src/result-view.tsx",
  },
  {
    name: "legacy-direct-member-still-warns",
    code: "const parsed = JSON.parse(raw); const selected = parsed.items;",
    expectedCount: 1,
    filename: "src/result-view.tsx",
  },
  {
    name: "legacy-direct-parse-method-still-warns",
    code: "const selected = JSON.parse(raw).find(predicate);",
    expectedCount: 1,
    filename: "src/result-view.tsx",
  },
  {
    name: "bare-local",
    code: "const parsed = JSON.parse(raw);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "optional-receiver",
    code: "const parsed = JSON.parse(raw); const selected = parsed?.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "optional-terminal-call",
    code: "const parsed = JSON.parse(raw); const selected = parsed.find?.(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "optional-inner-member",
    code: "const parsed = JSON.parse(raw); const selected = parsed.items?.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "dynamic-method",
    code: "const parsed = JSON.parse(raw); const selected = parsed[method](predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "nested-call-receiver",
    code: "const parsed = JSON.parse(raw); const selected = parsed.factory().find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "post-call-member",
    code: "const parsed = JSON.parse(raw); const selected = parsed.find(predicate).value;",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "await-terminal",
    code: "const select = async (raw) => { const parsed = JSON.parse(raw); return await parsed.find(predicate); };",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "new-terminal",
    code: "const parsed = JSON.parse(raw); const selected = new parsed.Factory();",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "tagged-terminal",
    code: "const parsed = JSON.parse(raw); const selected = parsed.format`text`;",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "logical-wrapper",
    code: "const parsed = JSON.parse(raw); const selected = enabled && parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "conditional-wrapper",
    code: "const parsed = JSON.parse(raw); const selected = enabled ? parsed.find(predicate) : null;",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "whole-value-alias",
    code: "const parsed = JSON.parse(raw); const alias = parsed; const selected = alias.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "whole-value-later-escape",
    code: "const parsed = JSON.parse(raw); const selected = parsed.find(predicate); receive(parsed);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "whole-value-call-argument",
    code: "const parsed = JSON.parse(raw); const selected = parsed.find(parsed);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "captured-later-reference",
    code: "const parsed = JSON.parse(raw); const selected = parsed.find(predicate); queue(() => parsed.length);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "deferred-initial-consumer",
    code: "const parsed = JSON.parse(raw); const selected = () => parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "later-member-replacement",
    code: "const parsed = JSON.parse(raw); const selected = parsed.find(predicate); parsed.find = replacement;",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "later-member-delete",
    code: "const parsed = JSON.parse(raw); const selected = parsed.find(predicate); delete parsed.find;",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "later-member-update",
    code: "const parsed = JSON.parse(raw); const selected = parsed.find(predicate); parsed.count++;",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "reassigned-binding",
    code: "let parsed = JSON.parse(raw); const selected = parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "separate-shape-guard",
    code: "const select = (raw) => { const parsed = JSON.parse(raw); if (!Array.isArray(parsed)) return; return parsed.find(predicate); };",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "schema-transport",
    code: "const parsed = JSON.parse(raw); const selected = schema.parse(parsed); selected.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "same-owner-try",
    code: "try { const parsed = JSON.parse(raw); const selected = parsed.find(predicate); } catch {}",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "valid-array-literal",
    code: 'const parsed = JSON.parse("[]"); const selected = parsed.find(predicate);',
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "stringify-roundtrip",
    code: "const parsed = JSON.parse(JSON.stringify(value)); const selected = parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "local-serializer-input",
    code: "const saved = JSON.stringify(value); const parsed = JSON.parse(saved); const selected = parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "paired-serializer-contract",
    code: "const serializeNotes = (value) => JSON.stringify(value); const deserializeNotes = (raw) => { const parsed = JSON.parse(raw); return parsed.find(predicate); };",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "shadowed-json",
    code: "const JSON = { parse: read }; const parsed = JSON.parse(raw); const selected = parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "json-method-replaced",
    code: "JSON.parse = replacement; const parsed = JSON.parse(raw); const selected = parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "global-json-method-replaced",
    code: "globalThis.JSON.parse = replacement; const parsed = JSON.parse(raw); const selected = parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "provider-escape",
    code: "inspect(JSON); const parsed = JSON.parse(raw); const selected = parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "global-eval-provider",
    code: "globalThis.eval(source); const parsed = JSON.parse(raw); const selected = parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "reviver",
    code: "const parsed = JSON.parse(raw, revive); const selected = parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "spread-parse-argument",
    code: "const parsed = JSON.parse(...values); const selected = parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "optional-parse",
    code: "const parsed = JSON.parse?.(raw); const selected = parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "multiple-declaration",
    code: "const parsed = JSON.parse(raw), other = null; const selected = parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "nonadjacent-read",
    code: "const parsed = JSON.parse(raw); inspect(other); const selected = parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "nonempty-fallback",
    code: "const select = (enabled, raw) => { const parsed = enabled ? JSON.parse(raw) : { find: fallback }; return parsed.find(predicate); };",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "unreachable-owner",
    code: "const select = (raw) => { return null; const parsed = JSON.parse(raw); return parsed.find(predicate); };",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "test-file-policy",
    code: "const parsed = JSON.parse(raw); const selected = parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.test.tsx",
  },
  {
    name: "script-file-policy",
    code: "const parsed = JSON.parse(raw); const selected = parsed.find(predicate);",
    expectedCount: 0,
    filename: "scripts/read-result.ts",
  },
  {
    name: "state-result-is-not-next-local-consumption",
    code: "const [parsed] = useState(() => JSON.parse(raw)); const selected = parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "runtime-typescript-provider",
    code: "enum Marker { Ready = inspect() } const parsed = JSON.parse(raw); const selected = parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "erased-runtime-name",
    code: "interface JSON {} const parsed = JSON.parse(raw); const selected = parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
  {
    name: "non-json-parser",
    code: "const parsed = parser.parse(raw); const selected = parsed.find(predicate);",
    expectedCount: 0,
    filename: "src/result-view.tsx",
  },
];

describe("no-unsafe-json-parse terminal local methods", () => {
  for (const source of cases) {
    it(source.name, () => {
      const result = runRule(noUnsafeJsonParse, source.code, { filename: source.filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(source.expectedCount);
    });
  }
});
