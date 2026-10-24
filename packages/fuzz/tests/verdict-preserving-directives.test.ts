import { describe, expect, it } from "vite-plus/test";
import { hasDirective } from "../../oxlint-plugin-react-doctor/src/plugin/utils/has-directive.js";
import { isFunctionLike } from "../../oxlint-plugin-react-doctor/src/plugin/utils/is-function-like.js";
import { walkAst } from "../../oxlint-plugin-react-doctor/src/plugin/utils/walk-ast.js";
import { parseFixture } from "../../oxlint-plugin-react-doctor/src/test-utils/parse-fixture.js";
import { buildVerdictPreservingVariants } from "../src/verdict-preserving-variants.js";

interface DirectiveCase {
  readonly name: string;
  readonly source: string;
  readonly preservedPrefix: string;
}

const cases: DirectiveCase[] = [
  {
    name: "multiple declaration directives",
    source: 'function task() { "custom"; "use strict"; work(); }',
    preservedPrefix: '"custom"; "use strict";; void 0;',
  },
  {
    name: "function expression directives",
    source: 'const task = function () { "custom"; "use strict"; work(); };',
    preservedPrefix: '"custom"; "use strict";; void 0;',
  },
  {
    name: "block arrow directives",
    source: 'const task = () => { "custom"; "use strict"; work(); };',
    preservedPrefix: '"custom"; "use strict";; void 0;',
  },
  {
    name: "semicolonless directives",
    source: 'function task() { "custom"\n"use strict"\nwork(); }',
    preservedPrefix: '"custom"\n"use strict"; void 0;',
  },
  {
    name: "comments between directives",
    source: 'function task() { "custom"; /* retained */ "use strict" // retained\nwork(); }',
    preservedPrefix: '"custom"; /* retained */ "use strict"; void 0; // retained',
  },
  {
    name: "directive only body",
    source: 'function task() { "custom"; "use strict" }',
    preservedPrefix: '"custom"; "use strict"; void 0;',
  },
  {
    name: "escaped directive remains escaped",
    source: 'function task() { "use\\x20strict"; work(); }',
    preservedPrefix: '"use\\x20strict";; void 0;',
  },
  {
    name: "line continued directive remains continued",
    source: 'function task() { "us\\\ne strict"; work(); }',
    preservedPrefix: '"us\\\ne strict";; void 0;',
  },
  {
    name: "nested directives",
    source:
      'function outer() { "use strict"; function inner() { "custom"; "use client"; work(); } inner(); }',
    preservedPrefix: '"custom"; "use client";; void 0;',
  },
  {
    name: "parenthesized string is not promoted",
    source: 'function task() { ("use strict"); work(); }',
    preservedPrefix: '{ void 0; ("use strict")',
  },
  {
    name: "late string is not promoted",
    source: 'function task() { work(); "use strict"; }',
    preservedPrefix: '{ void 0; work(); "use strict";',
  },
  {
    name: "non directive after existing prologue",
    source: 'function task() { "custom"; ("use strict"); work(); }',
    preservedPrefix: '"custom";; void 0; ("use strict")',
  },
];

const readDirectiveFacts = (source: string): boolean[][] => {
  const parsed = parseFixture(source, { filename: "directive-fixture.js" });
  expect(parsed.errors).toEqual([]);
  const facts: boolean[][] = [];
  walkAst(parsed.program, (node) => {
    if (!isFunctionLike(node)) return;
    facts.push([
      hasDirective(node, "custom"),
      hasDirective(node, "use strict"),
      hasDirective(node, "use client"),
    ]);
  });
  return facts;
};

describe("no-op variants preserve directive prologues", () => {
  it.each(cases)("$name", ({ source, preservedPrefix }) => {
    const variant = buildVerdictPreservingVariants(source, "directive-fixture.js").find(
      (candidate) => candidate.label === "no-op prologue statement in every function body",
    );
    expect(variant).toBeDefined();
    expect(variant?.mustPreserveVerdict).toBe(true);
    expect(variant?.code).toContain(preservedPrefix);
    expect(readDirectiveFacts(variant?.code ?? "")).toEqual(readDirectiveFacts(source));
  });

  it("preserves actual strict function this behavior", () => {
    const source = 'function strictThis() { "custom"; "use strict"; return this; }';
    const variant = buildVerdictPreservingVariants(source, "directive-fixture.js").find(
      (candidate) => candidate.label === "no-op prologue statement in every function body",
    );
    expect(variant).toBeDefined();
    const executeOriginal = new Function(`${source}; return strictThis();`);
    const executeVariant = new Function(`${variant?.code ?? ""}; return strictThis();`);
    expect(executeOriginal()).toBeUndefined();
    expect(executeVariant()).toBeUndefined();
  });

  it("retains the previous no-directive insertion", () => {
    const source = "function task() { work(); }";
    const variant = buildVerdictPreservingVariants(source, "directive-fixture.js").find(
      (candidate) => candidate.label === "no-op prologue statement in every function body",
    );
    expect(variant?.code).toBe("function task() { void 0; work(); }");
  });
});
