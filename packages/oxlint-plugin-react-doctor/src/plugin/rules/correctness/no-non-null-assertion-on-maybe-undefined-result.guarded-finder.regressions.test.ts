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
  useLiteralPatterns?: boolean;
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
    name: "readonly string snapshot predicate",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    diagnosticCount: 0,
  },
  {
    name: "transparent readonly string snapshot",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = (node.className as string); return "string" === typeof label && !!(label.match(pattern)); }',
    diagnosticCount: 0,
  },
  {
    name: "inline readonly string snapshot predicate",
    useLiteralPatterns: true,
    resultDeclaration:
      'const parent = findUpUntil(element, node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); });',
    diagnosticCount: 0,
  },
  {
    name: "readonly snapshot with renamed genuine provider",
    useLiteralPatterns: true,
    importDeclaration:
      'import { findUpUntil as findParent } from "@cloudscape-design/component-toolkit/dom";',
    resultDeclaration: "const parent = findParent(element, predicate);",
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    diagnosticCount: 0,
  },
  {
    name: "readonly snapshot nullable Finder initializer",
    useLiteralPatterns: true,
    resultDeclaration: "const parent = element ? findUpUntil(element, predicate) : undefined;",
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    diagnosticCount: 0,
  },
  {
    name: "readonly snapshot null Finder alternate",
    useLiteralPatterns: true,
    resultDeclaration: "const parent = element ? findUpUntil(element, predicate) : null;",
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    diagnosticCount: 0,
  },
  {
    name: "readonly snapshot immediately guarded return",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    consumer:
      'if (parent && typeof parent.className === "string") { return parent.className.match(pattern)![1]; } return "";',
    diagnosticCount: 0,
  },
  {
    name: "snapshot object default result cannot prove Finder ran",
    useLiteralPatterns: true,
    resultDeclaration: "const { parent = findUpUntil(element, predicate) } = provided;",
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot array default result cannot prove Finder ran",
    useLiteralPatterns: true,
    resultDeclaration: "const [parent = findUpUntil(element, predicate)] = provided;",
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot nested default result cannot prove Finder ran",
    useLiteralPatterns: true,
    resultDeclaration: "const { group: { parent = findUpUntil(element, predicate) } } = provided;",
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot renamed default result cannot prove Finder ran",
    useLiteralPatterns: true,
    resultDeclaration: "const { ancestor: parent = findUpUntil(element, predicate) } = provided;",
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot conditional default result cannot prove Finder ran",
    useLiteralPatterns: true,
    resultDeclaration:
      "const { parent = element ? findUpUntil(element, predicate) : undefined } = provided;",
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot assignment before match",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return (node.className = "missing") && typeof label === "string" && !!label.match(pattern); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot getter before match",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return node.trigger && typeof label === "string" && !!label.match(pattern); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot ignored match argument mutation",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern, (node.className = "missing")); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot ignored match argument getter",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern, node.trigger); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot captured guard",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return enabled && typeof label === "string" && !!label.match(pattern); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot optional method call",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match?.(pattern); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot optional member",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label?.match(pattern); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot computed method",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label["match"](pattern); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot from a different parameter binding",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = element.className; return typeof label === "string" && !!label.match(pattern); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot mutable local",
    useLiteralPatterns: true,
    predicate:
      'node => { let label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot with extra declaration",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; const ignored = mutate(node); return typeof label === "string" && !!label.match(pattern); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot parameter default",
    useLiteralPatterns: true,
    predicate:
      '((node = mutate(element)) => { const label = node.className; return typeof label === "string" && !!label.match(pattern); })',
    diagnosticCount: 1,
  },
  {
    name: "snapshot bound callback argument",
    useLiteralPatterns: true,
    predicate:
      '((node) => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }).bind(null, fallback)',
    diagnosticCount: 1,
  },
  {
    name: "snapshot foreign provider",
    useLiteralPatterns: true,
    importDeclaration: 'import { findUpUntil } from "./other-finder";',
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot global provider remains unsupported",
    useLiteralPatterns: true,
    importDeclaration: "",
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot global regex remains unsupported",
    useLiteralPatterns: true,
    pattern: "/panel-([a-z]+)/g",
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot consumer mutation remains reportable",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    consumer:
      'const value = parent ? (parent.className = "missing", parent.className.match(pattern)![1]) : ""; return value;',
    diagnosticCount: 1,
  },
  {
    name: "snapshot asserted ignored argument mutates regex",
    useLiteralPatterns: false,
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    consumer:
      'const value = parent ? parent.className.match(pattern, pattern.compile("missing"))![1] : ""; return value;',
    diagnosticCount: 1,
  },
  {
    name: "snapshot asserted optional call remains unsupported",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    consumer: 'const value = parent ? parent.className.match?.(pattern)![1] : ""; return value;',
    diagnosticCount: 1,
  },
  {
    name: "snapshot asserted computed method remains unsupported",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    consumer: 'const value = parent ? parent.className["match"](pattern)![1] : ""; return value;',
    diagnosticCount: 1,
  },
  {
    name: "snapshot optional consumer remains unsupported",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    consumer: 'return parent?.className.match(pattern)![1] ?? "";',
    diagnosticCount: 1,
  },
  {
    name: "snapshot optional consumer after setAttribute",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    consumer:
      'parent?.setAttribute("class", "missing"); return parent?.className.match(pattern)![1];',
    diagnosticCount: 1,
  },
  {
    name: "snapshot optional consumer after className write",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    consumer:
      'if (parent) parent.className = "missing"; return parent?.className.match(pattern)![1];',
    diagnosticCount: 1,
  },
  {
    name: "snapshot optional consumer after opaque mutation",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    consumer: "mutate(parent); return parent?.className.match(pattern)![1];",
    diagnosticCount: 1,
  },
  {
    name: "snapshot normalized consumer remains unsupported",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    consumer:
      'if (!parent) return ""; const label = typeof parent.className === "string" ? parent.className : (parent.getAttribute("class") ?? ""); return label.match(pattern)![1];',
    diagnosticCount: 1,
  },
  {
    name: "snapshot normalized consumer after className write",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    consumer:
      'if (!parent) return ""; parent.className = "missing"; const label = typeof parent.className === "string" ? parent.className : (parent.getAttribute("class") ?? ""); return label.match(pattern)![1];',
    diagnosticCount: 1,
  },
  {
    name: "snapshot normalized consumer after setAttribute",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    consumer:
      'if (!parent) return ""; parent.setAttribute("class", "missing"); const label = typeof parent.className === "string" ? parent.className : (parent.getAttribute("class") ?? ""); return label.match(pattern)![1];',
    diagnosticCount: 1,
  },
  {
    name: "snapshot normalized consumer after opaque mutation",
    useLiteralPatterns: true,
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    consumer:
      'if (!parent) return ""; mutate(parent); const label = typeof parent.className === "string" ? parent.className : (parent.getAttribute("class") ?? ""); return label.match(pattern)![1];',
    diagnosticCount: 1,
  },
  {
    name: "snapshot const regex binding remains unsupported",
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    diagnosticCount: 1,
  },
  {
    name: "snapshot finder ignored argument compiles predicate pattern",
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    resultDeclaration: 'const parent = findUpUntil(element, predicate, pattern.compile("other"));',
    consumer:
      'const value = parent ? parent.className.match(/panel-([a-z]+)/)![1] : ""; return value;',
    diagnosticCount: 1,
  },
  {
    name: "snapshot prior compile changes predicate pattern",
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    resultDeclaration: 'pattern.compile("other"); const parent = findUpUntil(element, predicate);',
    consumer:
      'const value = parent ? parent.className.match(/panel-([a-z]+)/)![1] : ""; return value;',
    diagnosticCount: 1,
  },
  {
    name: "snapshot predicate pattern escapes to unknown code",
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(pattern); }',
    resultDeclaration: "mutate(pattern); const parent = findUpUntil(element, predicate);",
    consumer:
      'const value = parent ? parent.className.match(/panel-([a-z]+)/)![1] : ""; return value;',
    diagnosticCount: 1,
  },
  {
    name: "snapshot separate regex binding remains unsupported",
    predicate:
      'node => { const label = node.className; return typeof label === "string" && !!label.match(/panel-([a-z]+)/); }',
    diagnosticCount: 1,
  },
  {
    name: "boolean predicate alias remains unsupported",
    predicate:
      'node => { const didMatch = typeof node.className === "string" && !!node.className.match(pattern); return didMatch; }',
    diagnosticCount: 1,
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
      useLiteralPatterns = false,
    }) => {
      const predicateSource = useLiteralPatterns
        ? predicate.replaceAll("pattern", pattern)
        : predicate;
      const consumerSource = useLiteralPatterns
        ? consumer.replaceAll("pattern", pattern)
        : consumer;
      const resultSource = useLiteralPatterns
        ? resultDeclaration.replaceAll("pattern", pattern)
        : resultDeclaration;
      const result = runRule(
        noNonNullAssertionOnMaybeUndefinedResult,
        `
      ${importDeclaration}
      const pattern = ${pattern};
      const read = (${parameters}) => {
        const predicate = ${predicateSource};
        ${resultSource}
        ${consumerSource}
      };
    `,
        { filename: "src/read-panel-label.ts" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(diagnosticCount);
    },
  );
});
