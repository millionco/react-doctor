import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noArrayIndexDerefWithoutBoundsOrEmptyGuard } from "./no-array-index-deref-without-bounds-or-empty-guard.js";

interface SplitAliasCase {
  name: string;
  code: string;
  expectedCount: number;
}

const commonOptions: RunRuleOptions = {
  filename: "independent-split-label.tsx",
  forceJsx: true,
  includeLocations: true,
  settings: {
    "react-doctor": {
      capabilities: ["react"],
    },
  },
};

const cases: SplitAliasCase[] = [
  {
    name: "readonly-split-alias",
    code: 'const Label = ({ text }) => { const pieces = text.split("~"); return <span>{pieces[1].trim()}</span>; };',
    expectedCount: 1,
  },
  {
    name: "direct-split-positive",
    code: 'const Label = ({ text }) => <span>{text.split("~")[1].trim()}</span>;',
    expectedCount: 1,
  },
  {
    name: "delimiter-presence-guard",
    code: 'const Label = ({ text }) => { if (!text.includes("~")) return null; const pieces = text.split("~"); return <span>{pieces[1].trim()}</span>; };',
    expectedCount: 0,
  },
  {
    name: "alias-length-guard",
    code: 'const Label = ({ text }) => { const pieces = text.split("~"); return pieces.length > 1 ? <span>{pieces[1].trim()}</span> : null; };',
    expectedCount: 0,
  },
  {
    name: "static-present-part",
    code: 'const Label = () => { const pieces = "left~right".split("~"); return <span>{pieces[1].trim()}</span>; };',
    expectedCount: 0,
  },
  {
    name: "optional-part-deref",
    code: 'const Label = ({ text }) => { const pieces = text.split("~"); return <span>{pieces[1]?.trim()}</span>; };',
    expectedCount: 0,
  },
  {
    name: "index-zero-always-present",
    code: 'const Label = ({ text }) => { const pieces = text.split("~"); return <span>{pieces[0].trim()}</span>; };',
    expectedCount: 0,
  },
  {
    name: "ordinary-array-policy",
    code: "const Label = ({ records, selected }) => <span>{records[selected].name}</span>;",
    expectedCount: 0,
  },
  {
    name: "mutable-alias-abstention",
    code: 'const Label = ({ text, replacement }) => { let pieces = text.split("~"); pieces = replacement; return <span>{pieces[1].trim()}</span>; };',
    expectedCount: 0,
  },
  {
    name: "array-mutator-abstention",
    code: 'const Label = ({ text }) => { const pieces = text.split("~"); pieces.pop(); return <span>{pieces[1].trim()}</span>; };',
    expectedCount: 0,
  },
  {
    name: "array-transport-abstention",
    code: 'const Label = ({ text, inspect }) => { const pieces = text.split("~"); inspect(pieces); return <span>{pieces[1].trim()}</span>; };',
    expectedCount: 0,
  },
  {
    name: "shadowed-producer-abstention",
    code: 'const Label = ({ text, records }) => { const pieces = text.split("~"); { const pieces = records; return <span>{pieces[1].label}</span>; } };',
    expectedCount: 0,
  },
  {
    name: "transparent-split-alias",
    code: 'const Label = ({ text }: { text: string }) => { const pieces = (text.split("~") as string[]); return <span>{pieces[1].trim()}</span>; };',
    expectedCount: 1,
  },
  {
    name: "member-receiver-split-alias",
    code: 'const Label = ({ record }) => { const pieces = record.label.split("~"); return <span>{pieces[1].trim()}</span>; };',
    expectedCount: 1,
  },
  {
    name: "later-part-positive",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); return pieces[2].trim(); };',
    expectedCount: 1,
  },
  {
    name: "dynamic-index-abstention",
    code: 'const readLabel = (text, selected) => { const pieces = text.split("~"); return pieces[selected].trim(); };',
    expectedCount: 0,
  },
  {
    name: "string-index-abstention",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); return pieces["1"].trim(); };',
    expectedCount: 0,
  },
  {
    name: "fractional-index-abstention",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); return pieces[1.5].trim(); };',
    expectedCount: 0,
  },
  {
    name: "negative-index-abstention",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); return pieces[-1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "truthy-part-branch",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); if (pieces[1]) return pieces[1].trim(); return ""; };',
    expectedCount: 0,
  },
  {
    name: "truthy-part-early-return",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); if (!pieces[1]) return ""; return pieces[1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "truthy-part-ternary",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); return pieces[1] ? pieces[1].trim() : ""; };',
    expectedCount: 0,
  },
  {
    name: "truthy-part-logical",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); return pieces[1] && pieces[1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "nonnull-part-branch",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); if (pieces[1] != null) return pieces[1].trim(); return ""; };',
    expectedCount: 0,
  },
  {
    name: "undefined-part-branch",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); if (pieces[1] !== undefined) return pieces[1].trim(); return ""; };',
    expectedCount: 0,
  },
  {
    name: "undefined-part-early-return",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); if (pieces[1] === undefined) return ""; return pieces[1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "strict-null-is-not-presence",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); if (pieces[1] === null) return ""; return pieces[1].trim(); };',
    expectedCount: 1,
  },
  {
    name: "shadowed-undefined-is-not-presence",
    code: 'const readLabel = (text, undefined) => { const pieces = text.split("~"); if (pieces[1] === undefined) return ""; return pieces[1].trim(); };',
    expectedCount: 1,
  },
  {
    name: "different-part-is-not-presence",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); if (pieces[0]) return pieces[1].trim(); return ""; };',
    expectedCount: 1,
  },
  {
    name: "different-binding-is-not-presence",
    code: 'const readLabel = (text, otherText) => { const pieces = text.split("~"); const otherPieces = otherText.split("~"); return otherPieces[1] ? pieces[1].trim() : ""; };',
    expectedCount: 1,
  },
  {
    name: "disjunction-is-not-presence",
    code: 'const readLabel = (text, ready) => { const pieces = text.split("~"); return pieces[1] || ready ? pieces[1].trim() : ""; };',
    expectedCount: 1,
  },
  {
    name: "conjunction-preserves-presence",
    code: 'const readLabel = (text, ready) => { const pieces = text.split("~"); return pieces[1] && ready ? pieces[1].trim() : ""; };',
    expectedCount: 0,
  },
  {
    name: "var-alias-abstention",
    code: 'const readLabel = (text) => { var pieces = text.split("~"); return pieces[1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "const-binding-write-abstention",
    code: 'const readLabel = (text, replacement) => { const pieces = text.split("~"); pieces = replacement; return pieces[1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "indexed-write-abstention",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); pieces[1] = "safe"; return pieces[1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "length-write-abstention",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); pieces.length = 0; return pieces[1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "indexed-delete-abstention",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); delete pieces[1]; return pieces[1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "pattern-write-abstention",
    code: 'const readLabel = (text, replacement) => { const pieces = text.split("~"); [pieces[1]] = replacement; return pieces[1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "loop-target-write-abstention",
    code: 'const readLabel = (text, values) => { const pieces = text.split("~"); for (pieces[1] of values) {} return pieces[1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "array-method-abstention",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); pieces.push("safe"); return pieces[1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "whole-array-return-abstention",
    code: 'const readLabel = (text, ready) => { const pieces = text.split("~"); if (ready) return pieces; return pieces[1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "second-hop-alias-abstention",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); const copiedPieces = pieces; return copiedPieces[1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "cross-function-capture-abstention",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); return () => pieces[1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "module-owned-array-abstention",
    code: 'const pieces = input.split("~"); const readLabel = () => pieces[1].trim();',
    expectedCount: 0,
  },
  {
    name: "later-declaration-abstention",
    code: 'const readLabel = (text) => { consume(pieces[1].trim()); const pieces = text.split("~"); };',
    expectedCount: 0,
  },
  {
    name: "other-scalar-part-use",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); consume(pieces[0]); return pieces[1].trim(); };',
    expectedCount: 1,
  },
  {
    name: "known-iso-format",
    code: 'const readLabel = () => { const pieces = new Date().toISOString().split("T"); return pieces[1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "known-short-literal",
    code: 'const readLabel = () => { const pieces = "plain".split("~"); return pieces[1].trim(); };',
    expectedCount: 1,
  },
  {
    name: "delimiter-guard-before-initializer",
    code: 'const readLabel = (text) => { if (text.includes("~")) { const pieces = text.split("~"); return pieces[1].trim(); } return ""; };',
    expectedCount: 0,
  },
  {
    name: "wrapped-index-receiver",
    code: 'const readLabel = (text: string) => { const pieces = text.split("~"); return (pieces[1] as string).trim(); };',
    expectedCount: 1,
  },
  {
    name: "conditional-producer-abstention",
    code: 'const readLabel = (text, ready, replacement) => { const pieces = ready ? text.split("~") : replacement; return pieces[1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "ordinary-constant-array-abstention",
    code: "const readLabel = () => { const pieces = []; return pieces[1].label; };",
    expectedCount: 0,
  },
  {
    name: "legacy-direct-report-survives-alias-abstention",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); consume(pieces); return text.split("~")[1].trim(); };',
    expectedCount: 1,
  },
  {
    name: "nested-same-name-owner-positive",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); const otherReader = (otherText) => { const pieces = otherText.split("~"); return pieces[1]?.trim(); }; return pieces[1].trim(); };',
    expectedCount: 1,
  },
  {
    name: "unrelated-length-abstention",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); consume(pieces.length); return pieces[1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "optional-index-base",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); return pieces?.[1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "global-eval-capability-abstention",
    code: 'const readLabel = (text) => { const pieces = text.split("~"); void eval; return pieces[1].trim(); };',
    expectedCount: 0,
  },
  {
    name: "shadowed-eval-keeps-alias-positive",
    code: 'const readLabel = (text, eval) => { const pieces = text.split("~"); void eval; return pieces[1].trim(); };',
    expectedCount: 1,
  },
];

describe("readonly short split aliases", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(noArrayIndexDerefWithoutBoundsOrEmptyGuard, code, commonOptions);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
