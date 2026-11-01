import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayFindResultMemberAccessWithoutGuard } from "./no-array-find-result-member-access-without-guard.js";

describe("positive find receiver or callback evidence", () => {
  it.each([
    {
      name: "unknown-lowercase-query-on-member-receiver",
      code: "const result = service.lookups.find(criteria).create();",
      options: {
        filename: "synthetic-find-query-evidence.ts",
        includeLocations: true,
      },
      diagnostics: [],
    },
    {
      name: "unknown-query-on-instance",
      code: "const collection = new Store(); const value = collection.find(query).count();",
      options: {
        filename: "synthetic-find-query-evidence.ts",
        includeLocations: true,
      },
      diagnostics: [],
    },
    {
      name: "unknown-query-parameter-on-this-model",
      code: "class Service { run(query) { return this.model.find(query).lean(); } }",
      options: {
        filename: "synthetic-find-query-evidence.ts",
        includeLocations: true,
      },
      diagnostics: [],
    },
    {
      name: "inline-callback-preserved",
      code: "const value = service.find(item => item.ready).count();",
      options: {
        filename: "synthetic-find-query-evidence.ts",
        includeLocations: true,
      },
      diagnostics: [
        {
          column: 14,
          line: 1,
          message:
            "`find` returns `undefined` when nothing matches, so reading from its result here throws `Cannot read properties of undefined` — use optional chaining (`?.`) or guard the result before you use it.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "resolved-function-predicate-preserved",
      code: "const accepts = item => item.ready; const value = records.find(accepts).create();",
      options: {
        filename: "synthetic-find-query-evidence.ts",
        includeLocations: true,
      },
      diagnostics: [
        {
          column: 50,
          line: 1,
          message:
            "`find` returns `undefined` when nothing matches, so reading from its result here throws `Cannot read properties of undefined` — use optional chaining (`?.`) or guard the result before you use it.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "global-boolean-preserved",
      code: "const value = records.find(Boolean).id;",
      options: {
        filename: "synthetic-find-query-evidence.ts",
        includeLocations: true,
      },
      diagnostics: [
        {
          column: 14,
          line: 1,
          message:
            "`find` returns `undefined` when nothing matches, so reading from its result here throws `Cannot read properties of undefined` — use optional chaining (`?.`) or guard the result before you use it.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "literal-array-opaque-predicate",
      code: "const value = [{count(){}}].find(predicate).count();",
      options: {
        filename: "synthetic-find-query-evidence.ts",
        includeLocations: true,
      },
      diagnostics: [
        {
          column: 14,
          line: 1,
          message:
            "`find` returns `undefined` when nothing matches, so reading from its result here throws `Cannot read properties of undefined` — use optional chaining (`?.`) or guard the result before you use it.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "readonly-array-opaque-predicate",
      code: "const records = [{id:1}]; const alias = records; const value = alias.find(predicate).id;",
      options: {
        filename: "synthetic-find-query-evidence.ts",
        includeLocations: true,
      },
      diagnostics: [
        {
          column: 63,
          line: 1,
          message:
            "`find` returns `undefined` when nothing matches, so reading from its result here throws `Cannot read properties of undefined` — use optional chaining (`?.`) or guard the result before you use it.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "reassigned-array-origin-not-proof",
      code: "let records = []; records = store; const value = records.find(query).id;",
      options: {
        filename: "synthetic-find-query-evidence.ts",
        includeLocations: true,
      },
      diagnostics: [],
    },
    {
      name: "unresolved-function-parameter-precision-gap",
      code: "function read(items, predicate) { if (!items.some(predicate)) return items.find(predicate).x; }",
      options: {
        filename: "synthetic-find-query-evidence.ts",
        includeLocations: true,
      },
      diagnostics: [],
    },
    {
      name: "old-object-query-bail-preserved",
      code: "const records = []; const query = {ready:true}; const value = records.find(query).id;",
      options: {
        filename: "synthetic-find-query-evidence.ts",
        includeLocations: true,
      },
      diagnostics: [],
    },
    {
      name: "old-uppercase-bail-preserved",
      code: "const Accepts = item => item.ready; const value = records.find(Accepts).id;",
      options: {
        filename: "synthetic-find-query-evidence.ts",
        includeLocations: true,
      },
      diagnostics: [],
    },
    {
      name: "member-predicate-literal-array-preserved",
      code: "const value = [{id:1}].find(filters.accepts).id;",
      options: {
        filename: "synthetic-find-query-evidence.ts",
        includeLocations: true,
      },
      diagnostics: [
        {
          column: 14,
          line: 1,
          message:
            "`find` returns `undefined` when nothing matches, so reading from its result here throws `Cannot read properties of undefined` — use optional chaining (`?.`) or guard the result before you use it.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "imported-opaque-predicate-precision-gap",
      code: 'import {accepts} from "./checks"; const value = records.find(accepts).id;',
      options: {
        filename: "synthetic-find-query-evidence.ts",
        includeLocations: true,
      },
      diagnostics: [],
    },
    {
      name: "abstains on a cyclic const receiver chain",
      code: "const records = alias; const alias = records; records.find(predicate).id;",
      options: {
        filename: "synthetic-find-query-evidence.ts",
        includeLocations: true,
      },
      diagnostics: [],
    },
    {
      name: "abstains on a shadowed unknown receiver",
      code: "const records = []; const read = (records, predicate) => records.find(predicate).id;",
      options: {
        filename: "synthetic-find-query-evidence.ts",
        includeLocations: true,
      },
      diagnostics: [],
    },
    {
      name: "abstains on a written const receiver binding",
      code: "const records = []; records = source; records.find(predicate).id;",
      options: {
        filename: "synthetic-find-query-evidence.ts",
        includeLocations: true,
      },
      diagnostics: [],
    },
    {
      name: "abstains on an unsupported mutable receiver binding",
      code: "let records = []; records.find(predicate).id;",
      options: {
        filename: "synthetic-find-query-evidence.ts",
        includeLocations: true,
      },
      diagnostics: [],
    },
  ])("$name", ({ code, options, diagnostics }) => {
    const result = runRule(noArrayFindResultMemberAccessWithoutGuard, code, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual(diagnostics);
  });

  it.each([
    "const accepts = item => item.ready; interface accepts {} const value = records.find(accepts).create();",
    "const records = [{id:1}]; interface records {} records.find(predicate).id;",
    "const records = [{id:1}]; const alias = records; type alias = unknown; alias.find(predicate).id;",
  ])("retains positive evidence through erased type names: %s", (code) => {
    const result = runRule(noArrayFindResultMemberAccessWithoutGuard, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "const accepts = item => item.ready; function read(accepts) { interface accepts {} return records.find(accepts).id; }",
    "const records = [{id:1}]; function read(records) { interface records {} return records.find(predicate).id; }",
    "const records = [{id:1}]; const alias = records; function read(alias) { type alias = unknown; return alias.find(predicate).id; }",
  ])("preserves opaque runtime receiver and predicate shadows: %s", (code) => {
    const result = runRule(noArrayFindResultMemberAccessWithoutGuard, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
