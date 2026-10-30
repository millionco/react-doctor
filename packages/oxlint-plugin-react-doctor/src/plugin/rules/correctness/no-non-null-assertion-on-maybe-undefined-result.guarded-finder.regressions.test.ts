import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNonNullAssertionOnMaybeUndefinedResult } from "./no-non-null-assertion-on-maybe-undefined-result.js";

interface GuardedFinderCase {
  name: string;
  consumer?: string;
  diagnosticCount: number;
  importDeclaration?: string;
  parameters?: string;
  predicate?: string;
  resultDeclaration?: string;
  pattern?: string;
}

const cases: GuardedFinderCase[] = [
  {
    name: "immediate truthy ternary",
    diagnosticCount: 0,
  },
  {
    name: "transparent string cast",
    consumer:
      'const value = parent ? (parent.className as string).match(pattern)![1] : ""; return value;',
    diagnosticCount: 0,
  },
  {
    name: "renamed genuine import",
    importDeclaration:
      'import { findUpUntil as findParent } from "@cloudscape-design/component-toolkit/dom";',
    resultDeclaration: "const parent = findParent(element, predicate);",
    diagnosticCount: 0,
  },
  {
    name: "nullable finder initializer",
    resultDeclaration: "const parent = element ? findUpUntil(element, predicate) : undefined;",
    diagnosticCount: 0,
  },
  {
    name: "different guard binding",
    consumer: 'const value = element ? parent.className.match(pattern)![1] : ""; return value;',
    diagnosticCount: 1,
  },
  {
    name: "assertion on falsy branch",
    consumer: 'const value = parent ? "" : parent.className.match(pattern)![1]; return value;',
    diagnosticCount: 1,
  },
  {
    name: "guard with an opaque call",
    consumer:
      'const value = parent && mutate(parent) ? parent.className.match(pattern)![1] : ""; return value;',
    diagnosticCount: 1,
  },
  {
    name: "mutation inside consequent",
    consumer:
      'const value = parent ? (parent.className = "missing", parent.className.match(pattern)![1]) : ""; return value;',
    diagnosticCount: 1,
  },
  {
    name: "intervening property mutation",
    consumer:
      'parent.className = "missing"; const value = parent ? parent.className.match(pattern)![1] : ""; return value;',
    diagnosticCount: 1,
  },
  {
    name: "intervening opaque escape",
    consumer:
      'mutate(parent); const value = parent ? parent.className.match(pattern)![1] : ""; return value;',
    diagnosticCount: 1,
  },
  {
    name: "second finder declarator mutates result",
    resultDeclaration: "const parent = findUpUntil(element, predicate), ignored = mutate(parent);",
    diagnosticCount: 1,
  },
  {
    name: "earlier consumer declarator mutates result",
    consumer:
      'const ignored = mutate(parent), value = parent ? parent.className.match(pattern)![1] : ""; return value;',
    diagnosticCount: 1,
  },
  {
    name: "different matched property",
    consumer: 'const value = parent ? parent.id.match(pattern)![1] : ""; return value;',
    diagnosticCount: 1,
  },
  {
    name: "different asserted pattern",
    consumer:
      'const value = parent ? parent.className.match(/other-([a-z]+)/)![1] : ""; return value;',
    diagnosticCount: 1,
  },
  {
    name: "sticky pattern",
    pattern: "/panel-([a-z]+)/y",
    diagnosticCount: 1,
  },
  {
    name: "global pattern",
    pattern: "/panel-([a-z]+)/g",
    diagnosticCount: 1,
  },
  {
    name: "shadowed finder import",
    parameters: "element: HTMLElement, findUpUntil: Function",
    diagnosticCount: 1,
  },
  {
    name: "foreign same-name import",
    importDeclaration: 'import { findUpUntil } from "./other-finder";',
    diagnosticCount: 1,
  },
  {
    name: "local same-name finder",
    importDeclaration: "const findUpUntil = (element, predicate) => element.parentElement;",
    diagnosticCount: 1,
  },
  {
    name: "post-match predicate mutation",
    predicate: 'node => !!node.className.match(pattern) && ((node.className = "missing"), true)',
    diagnosticCount: 1,
  },
  {
    name: "predicate succeeds without matching",
    predicate: "node => !!node.className.match(pattern) || true",
    diagnosticCount: 1,
  },
  {
    name: "async predicate",
    predicate:
      'async node => typeof node.className === "string" && !!node.className.match(pattern)',
    diagnosticCount: 1,
  },
  {
    name: "deferred ternary callback",
    consumer:
      'const value = () => parent ? parent.className.match(pattern)![1] : ""; return value;',
    diagnosticCount: 1,
  },
  {
    name: "non-nullish finder fallback",
    resultDeclaration: "const parent = element ? findUpUntil(element, predicate) : fallback;",
    diagnosticCount: 1,
  },
  {
    name: "existing immediate if and typeof guard",
    consumer:
      'if (parent && typeof parent.className === "string") { return parent.className.match(pattern)![1]; } return "";',
    diagnosticCount: 0,
  },
  {
    name: "existing optional result path",
    consumer: 'return parent?.className.match(pattern)![1] ?? "";',
    diagnosticCount: 0,
  },
  {
    name: "normalized predicate alias remains outside this proof",
    predicate:
      'node => { const label = typeof node.className === "string" ? node.className : ""; return !!label.match(pattern) && enabled; }',
    diagnosticCount: 1,
  },
];

describe("no-non-null-assertion-on-maybe-undefined-result guarded Finder consumers", () => {
  it.each(cases)(
    "$name",
    ({
      importDeclaration = 'import { findUpUntil } from "@cloudscape-design/component-toolkit/dom";',
      parameters = "element: HTMLElement",
      predicate = 'node => typeof node.className === "string" && !!node.className.match(pattern)',
      resultDeclaration = "const parent = findUpUntil(element, predicate);",
      pattern = "/panel-([a-z]+)/",
      consumer = 'const value = parent ? parent.className.match(pattern)![1] : ""; return value;',
      diagnosticCount,
    }) => {
      const result = runRule(
        noNonNullAssertionOnMaybeUndefinedResult,
        `
      ${importDeclaration}
      const pattern = ${pattern};
      const read = (${parameters}) => {
        const predicate = ${predicate};
        ${resultDeclaration}
        ${consumer}
      };
    `,
        { filename: "src/read-panel-label.ts" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(diagnosticCount);
    },
  );
});
