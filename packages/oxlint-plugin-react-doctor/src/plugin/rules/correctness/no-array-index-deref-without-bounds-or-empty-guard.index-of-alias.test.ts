import { describe, expect, it } from "vite-plus/test";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexDerefWithoutBoundsOrEmptyGuard } from "./no-array-index-deref-without-bounds-or-empty-guard.js";

const options: RunRuleOptions = {
  filename: "src/example.tsx",
  forceJsx: true,
  includeLocations: true,
};

const cases = [
  {
    name: "ambient-string-provider-mutation-retains-warning",
    code: 'declare const String: any; String.prototype.split = () => []; export const read = (input: string) => { const text = input; const position = text.indexOf("."); return position !== -1 ? text.split(".")[1].length : 0; };',
    count: 1,
  },
  {
    name: "ambient-global-provider-mutation-retains-warning",
    code: 'declare const globalThis: any; globalThis.String.prototype.split = () => []; export const read = (input: string) => { const text = input; const position = text.indexOf("."); return position !== -1 ? text.split(".")[1].length : 0; };',
    count: 1,
  },
  {
    name: "reflected-string-prototype-mutation-retains-warning",
    code: 'Object.getPrototypeOf("").split = () => []; export const read = (input: string) => { const text = input; const position = text.indexOf("."); return position !== -1 ? text.split(".")[1].length : 0; };',
    count: 1,
  },
  {
    name: "literal-constructor-prototype-mutation-retains-warning",
    code: '("").constructor.prototype.split = () => []; export const read = (input: string) => { const text = input; const position = text.indexOf("."); return position !== -1 ? text.split(".")[1].length : 0; };',
    count: 1,
  },
  {
    name: "destructured-prototype-reflection-retains-warning",
    code: 'const { getPrototypeOf: readPrototype } = Object; readPrototype("").split = () => []; export const read = (input: string) => { const text = input; const position = text.indexOf("."); return position !== -1 ? text.split(".")[1].length : 0; };',
    count: 1,
  },
  {
    name: "readonly-const-alias-conditional",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; const position = text.indexOf("."); return position !== -1 ? text.split(".")[1].length : 0; };\n',
    count: 0,
  },
  {
    name: "readonly-const-alias-if",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; const position = text.indexOf("."); if (position !== -1) return text.split(".")[1].trim(); return ""; };\n',
    count: 0,
  },
  {
    name: "negative-early-return",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; const position = text.indexOf("."); if (position === -1) return ""; return text.split(".")[1].trim(); };\n',
    count: 1,
  },
  {
    name: "reversed-nonminus-one",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; const position = text.indexOf("."); return -1 !== position ? text.split(".")[1].trim() : ""; };\n',
    count: 0,
  },
  {
    name: "greater-than-minus-one",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; const position = text.indexOf("."); return position > -1 ? text.split(".")[1].trim() : ""; };\n',
    count: 0,
  },
  {
    name: "reversed-less-than",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; const position = text.indexOf("."); return -1 < position ? text.split(".")[1].trim() : ""; };\n',
    count: 0,
  },
  {
    name: "wrong-delimiter",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(".")[1].trim() : ""; };\n',
    count: 1,
  },
  {
    name: "wrong-receiver",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; const position = text.indexOf("."); return position !== -1 ? other.split(".")[1].trim() : ""; };\n',
    count: 1,
  },
  {
    name: "bare-truthiness",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; const position = text.indexOf("."); return position ? text.split(".")[1].trim() : ""; };\n',
    count: 1,
  },
  {
    name: "wrong-zero-comparison",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; const position = text.indexOf("."); return position !== 0 ? text.split(".")[1].trim() : ""; };\n',
    count: 1,
  },
  {
    name: "unguarded-second-branch",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; const position = text.indexOf("."); return position !== -1 ? "" : text.split(".")[1].trim(); };\n',
    count: 1,
  },
  {
    name: "nondominating-if",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; const position = text.indexOf("."); if (position !== -1) void 0; return text.split(".")[1].trim(); };\n',
    count: 1,
  },
  {
    name: "third-split-part-unproved",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; const position = text.indexOf("."); return position !== -1 ? text.split(".")[2].trim() : ""; };\n',
    count: 1,
  },
  {
    name: "empty-delimiter",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; const position = text.indexOf(""); return position !== -1 ? text.split("")[1].trim() : ""; };\n',
    count: 1,
  },
  {
    name: "restricted-split-limit",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; const position = text.indexOf("."); return position !== -1 ? text.split(".", 1)[1].trim() : ""; };\n',
    count: 1,
  },
  {
    name: "mutable-result-binding",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; let position = text.indexOf("."); position = 0; return position !== -1 ? text.split(".")[1].trim() : ""; };\n',
    count: 1,
  },
  {
    name: "mutable-receiver-binding",
    code: 'export const readSegment = (input: string, other: string) => { let text = input; const position = text.indexOf("."); text = other; return position !== -1 ? text.split(".")[1].trim() : ""; };\n',
    count: 1,
  },
  {
    name: "pattern-write-result",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; let position = text.indexOf("."); [position] = [0]; return position !== -1 ? text.split(".")[1].trim() : ""; };\n',
    count: 1,
  },
  {
    name: "loop-write-result",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; let position = text.indexOf("."); for (position of [0]) {} return position !== -1 ? text.split(".")[1].trim() : ""; };\n',
    count: 1,
  },
  {
    name: "second-hop-alias-unproved",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; const position = text.indexOf("."); const forwarded = position; return forwarded !== -1 ? text.split(".")[1].trim() : ""; };\n',
    count: 1,
  },
  {
    name: "receiver-shadow-in-nested-function",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; const position = text.indexOf("."); return (() => { const text = other; return position !== -1 ? text.split(".")[1].trim() : ""; })(); };\n',
    count: 1,
  },
  {
    name: "existing-direct-indexof-guard",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; return text.indexOf(".") !== -1 ? text.split(".")[1].trim() : ""; };\n',
    count: 0,
  },
  {
    name: "existing-literal-static-parts",
    code: 'export const readSegment = (input: string, other: string) => { return "left.right".split(".")[1].trim(); };\n',
    count: 0,
  },
  {
    name: "runtime-eval-ambiguity",
    code: 'export const readSegment = (input: string, other: string) => { const text = input; const position = text.indexOf("."); void eval; return position !== -1 ? text.split(".")[1].trim() : ""; };\n',
    count: 1,
  },
  {
    name: "native-number-parameter-to-string-role",
    code: 'export const readPart=(value:number)=>{const text=value.toString();const index=text.indexOf(":");return index!==-1?text.split(":")[1].length:0;};\n',
    count: 0,
  },
  {
    name: "custom-object-method-names-not-native-proof",
    code: 'export const readPart=()=>{const text={indexOf:()=>0,split:()=>[]};const index=text.indexOf(":");return index!==-1?text.split(":")[1].length:0;};\n',
    count: 1,
  },
  {
    name: "opaque-producer-not-native-proof",
    code: 'import {readValue}from"example-value";export const readPart=()=>{const text=readValue();const index=text.indexOf(":");return index!==-1?text.split(":")[1].length:0;};\n',
    count: 1,
  },
  {
    name: "symmetric-loose-missing-position",
    code: 'export const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); return -1 != position ? text.split(":")[1].length : 0; };\n',
    count: 0,
  },
  {
    name: "positive-loose-missing-position",
    code: 'export const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); return position != -1 ? text.split(":")[1].length : 0; };\n',
    count: 0,
  },
  {
    name: "conjunction-preserves-positive-proof",
    code: 'export const readPart = (input: string, enabled: boolean) => { const text = input; const position = text.indexOf(":"); return enabled && position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 0,
  },
  {
    name: "disjunction-does-not-prove-delimiter",
    code: 'export const readPart = (input: string, enabled: boolean) => { const text = input; const position = text.indexOf(":"); return enabled || position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "both-disjuncts-prove-delimiter",
    code: 'export const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); return position !== -1 || position > -1 ? text.split(":")[1].length : 0; };\n',
    count: 0,
  },
  {
    name: "same-name-position-in-other-function-not-proof",
    code: 'export const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); const choose = (position: number) => position !== -1 ? text.split(":")[1].length : 0; return choose(0); };\n',
    count: 1,
  },
  {
    name: "parameter-direct-assignment",
    code: 'export const readPart = (input: string) => { input = "missing"; const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "parameter-array-pattern-write",
    code: 'export const readPart = (input: string) => { [input] = ["missing"]; const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "parameter-object-pattern-write",
    code: 'export const readPart = (input: string) => { ({ input } = { input: "missing" }); const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "parameter-loop-pattern-write",
    code: 'export const readPart = (input: string) => { for ([input] of [["missing"]]) {} const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "receiver-const-pattern-write",
    code: 'export const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); [text] = ["missing"]; return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "receiver-const-loop-pattern-write",
    code: 'export const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); for ({text} of [{text:"missing"}]) {} return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "position-const-object-pattern-write",
    code: 'export const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); ({position} = {position:0}); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "receiver-alias-chain-not-native-proof",
    code: 'export const readPart = (input: string) => { const forwarded = input; const text = forwarded; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "untyped-parameter-not-native-proof",
    code: 'export const readPart = (input) => { const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "any-parameter-not-native-proof",
    code: 'export const readPart = (input: any) => { const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "boxed-string-parameter-not-native-proof",
    code: 'export const readPart = (input: String) => { const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "union-parameter-not-native-proof",
    code: 'export const readPart = (input: string | { split(): never[]; indexOf(): number }) => { const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "asserted-parameter-not-native-proof",
    code: 'export const readPart = (input: unknown) => { const text = input as string; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "destructured-string-input-outside-direct-profile",
    code: 'export const readPart = ({input}: {input: string}) => { const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "default-parameter-outside-direct-profile",
    code: 'export const readPart = (input: string = "") => { const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "number-to-string-with-argument-outside-profile",
    code: 'export const readPart = (input: number) => { const text = input.toString(16); const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "custom-to-string-parameter-not-native-proof",
    code: 'export const readPart = (input: { toString(): string }) => { const text = input.toString(); const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "optional-index-of-call-outside-profile",
    code: 'export const readPart = (input: string) => { const text = input; const position = text.indexOf?.(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "index-of-start-position-outside-profile",
    code: 'export const readPart = (input: string) => { const text = input; const position = text.indexOf(":", 1); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "reversed-wrong-relational-direction",
    code: 'export const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); return -1 > position ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "less-than-comparison-does-not-prove-delimiter",
    code: 'export const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); return position < -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "equal-missing-position-is-unsafe",
    code: 'export const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); return position === -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "null-comparison-does-not-prove-delimiter",
    code: 'export const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); return position !== null ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "negated-alias-comparison-deferred",
    code: 'export const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); return !(position === -1) ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "unrelated-position-shadow-retains-warning",
    code: 'export const readPart = (input: string) => { const text = input; const position = 0; return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "runtime-enum-owner-abstention",
    code: 'export const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); enum Marker { First = 0 } return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "erased-type-query-does-not-change-runtime-proof",
    code: 'export const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); let unused: typeof text; return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 0,
  },
  {
    name: "computed-static-native-methods",
    code: 'export const readPart = (input: string) => { const text = input; const position = text["indexOf"](":"); return position !== -1 ? text["split"](":")[1].length : 0; };\n',
    count: 0,
  },
  {
    name: "multi-character-delimiter",
    code: 'export const readPart = (input: string) => { const text = input; const position = text.indexOf("::"); return position !== -1 ? text.split("::")[1].length : 0; };\n',
    count: 0,
  },
  {
    name: "number-parameter-string-role",
    code: 'export const readPart = (input: number) => { const text = input.toString(); const position = text.indexOf("."); return -1 < position ? text.split(".")[1].length : 0; };\n',
    count: 0,
  },
  {
    name: "canonical-string-prototype-exposure",
    code: 'void String.prototype;\nexport const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "canonical-number-prototype-exposure",
    code: 'void Number.prototype;\nexport const readPart = (input: number) => { const text = input.toString(); const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "static-global-string-provider-exposure",
    code: 'void globalThis.String.prototype;\nexport const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "whole-constructor-alias-exposure",
    code: 'const NativeString = String;\nvoid NativeString;\nexport const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "shadowed-local-constructor-is-unrelated",
    code: 'const String = { prototype: {} }; void String.prototype;\nexport const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 0,
  },
  {
    name: "ordinary-unrelated-global-read",
    code: 'void Math.PI;\nexport const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 0,
  },
  {
    name: "global-object-constructor-exposure",
    code: 'void globalThis.constructor;\nexport const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "runtime-string-interface-mask",
    code: 'interface String {}\nvoid String.prototype;\nexport const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "runtime-number-type-alias-mask",
    code: 'type Number = number;\nvoid Number.prototype;\nexport const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "runtime-global-object-interface-mask",
    code: 'interface globalThis {}\nvoid globalThis.String.prototype;\nexport const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "runtime-type-import-declaration-mask",
    code: 'import type { String } from "typed-host";\nvoid String.prototype;\nexport const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
  {
    name: "runtime-inline-type-import-specifier-mask",
    code: 'import { type Number, ordinaryValue } from "typed-host";\nvoid ordinaryValue;\nvoid Number.prototype;\nexport const readPart = (input: string) => { const text = input; const position = text.indexOf(":"); return position !== -1 ? text.split(":")[1].length : 0; };\n',
    count: 1,
  },
];

describe("readonly indexOf delimiter guards", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(noArrayIndexDerefWithoutBoundsOrEmptyGuard, testCase.code, options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.count);
    });
  }
});
