import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexDerefWithoutBoundsOrEmptyGuard } from "./no-array-index-deref-without-bounds-or-empty-guard.js";

const commonOptions = { filename: "src/example.tsx", forceJsx: true, includeLocations: true };

const cases = [
  {
    name: "inert-type-only-provider-import-keeps-native-proof",
    code: 'import type { RegExp } from "types"; export const read = (input: string) => /^a*/.exec(input)![0].length;',
    count: 0,
  },
  {
    name: "inert-ambient-provider-declaration-keeps-native-proof",
    code: "declare const RegExp: any; export const read = (input: string) => /^a*/.exec(input)![0].length;",
    count: 0,
  },
  {
    name: "ambient-variable-does-not-hide-runtime-provider-mutation",
    code: "declare const RegExp: any; RegExp.prototype.exec = () => null; export const read = (input: string) => /^a*/.exec(input)![0].length;",
    count: 1,
  },
  {
    name: "ambient-global-does-not-hide-runtime-provider-mutation",
    code: "declare const globalThis: any; globalThis.RegExp.prototype.exec = () => null; export const read = (input: string) => /^a*/.exec(input)![0].length;",
    count: 1,
  },
  {
    name: "ambient-class-does-not-hide-runtime-provider-mutation",
    code: "declare class RegExp {} RegExp.prototype.exec = () => null; export const read = (input: string) => /^a*/.exec(input)![0].length;",
    count: 1,
  },
  {
    name: "opaque-string-method-name-does-not-close-regex-escape",
    code: 'import matcher from "matcher-tools"; matcher.match(/x/); export const read = (input: string) => input.match(/^a*/)![0].length;',
    count: 1,
  },
  {
    name: "string-literal-constructor-exposes-native-providers",
    code: '("").constructor.prototype.match = () => null; export const read = (input: string) => input.match(/^a*/)![0].length;',
    count: 1,
  },
  {
    name: "destructured-prototype-reflection-exposes-native-providers",
    code: 'const { getPrototypeOf: readPrototype } = Object; readPrototype("").match = () => null; export const read = (input: string) => input.match(/^a*/)![0].length;',
    count: 1,
  },
  {
    name: "erased-interface-does-not-hide-runtime-provider-mutation",
    code: "interface RegExp {} RegExp.prototype.exec = () => null; export const read = (input: string) => /^a*/.exec(input)![0].length;",
    count: 1,
  },
  {
    name: "erased-type-import-does-not-hide-runtime-provider-mutation",
    code: 'import type { RegExp } from "types"; RegExp.prototype.exec = () => null; export const read = (input: string) => /^a*/.exec(input)![0].length;',
    count: 1,
  },
  {
    name: "erased-import-specifier-does-not-hide-runtime-provider-mutation",
    code: 'import { type RegExp } from "types"; RegExp.prototype.exec = () => null; export const read = (input: string) => /^a*/.exec(input)![0].length;',
    count: 1,
  },
  {
    name: "erased-global-interface-does-not-hide-runtime-provider-mutation",
    code: "interface globalThis {} globalThis.RegExp.prototype.exec = () => null; export const read = (input: string) => /^a*/.exec(input)![0].length;",
    count: 1,
  },
  {
    name: "ordinary-regex-test-keeps-native-proof",
    code: "export const read = (input: string) => { /x/.test(input); return /^a*/.exec(input)![0].length; };",
    count: 0,
  },
  {
    name: "ordinary-string-replace-keeps-native-proof",
    code: 'export const read = (input: string) => { input.replace(/x/, ""); return /^a*/.exec(input)![0].length; };',
    count: 0,
  },
  {
    name: "literal-constructor-prototype-mutation-retains-warning",
    code: "(/x/).constructor.prototype.exec = () => null; export const read = (input: string) => /^a*/.exec(input)![0].length;",
    count: 1,
  },
  {
    name: "reflected-literal-prototype-mutation-retains-warning",
    code: "Object.getPrototypeOf(/x/).exec = () => null; export const read = (input: string) => /^a*/.exec(input)![0].length;",
    count: 1,
  },
  {
    name: "opaque-regex-escape-retains-warning",
    code: 'import { replaceMatcher } from "matcher-tools"; replaceMatcher(/x/); export const read = (input: string) => /^a*/.exec(input)![0].length;',
    count: 1,
  },
  {
    name: "native-string-terminal-literal-colon",
    code: "export const Example = (input: string) => { const width = input.match(/:*$/)![0].length; return <span>{width}</span>; };\n",
    count: 0,
  },
  {
    name: "native-exec-leading-literal-space",
    code: "export const Example = (input: string) => { const width = /^ */.exec(input)![0].length; return <span>{width}</span>; };\n",
    count: 0,
  },
  {
    name: "fresh-exec-leading-literal-letter",
    code: "export const Example = (input: string) => { const width = /^a*/.exec(input)![0].length; return <span>{width}</span>; };\n",
    count: 0,
  },
  {
    name: "string-literal-terminal-literal-digit",
    code: 'export const Example = (input: string) => { const width = "chapter".match(/7*$/)![0].length; return <span>{width}</span>; };\n',
    count: 0,
  },
  {
    name: "required-plus-remains-warning",
    code: "export const Example = (input: string) => { const width = input.match(/:+$/)![0].length; return <span>{width}</span>; };\n",
    count: 1,
  },
  {
    name: "required-suffix-remains-warning",
    code: "export const Example = (input: string) => { const width = input.match(/:*x$/)![0].length; return <span>{width}</span>; };\n",
    count: 1,
  },
  {
    name: "dual-anchors-remain-warning",
    code: "export const Example = (input: string) => { const width = input.match(/^:*$/)![0].length; return <span>{width}</span>; };\n",
    count: 1,
  },
  {
    name: "whole-match-proof-not-capture-one",
    code: "export const Example = (input: string) => { const width = /^( *)/.exec(input)![1].length; return <span>{width}</span>; };\n",
    count: 1,
  },
  {
    name: "global-flag-new-fact-unsupported",
    code: "export const Example = (input: string) => { const width = input.match(/:*$/g)![0].length; return <span>{width}</span>; };\n",
    count: 1,
  },
  {
    name: "sticky-flag-new-fact-unsupported",
    code: "export const Example = (input: string) => { const width = /:*$/y.exec(input)![0].length; return <span>{width}</span>; };\n",
    count: 1,
  },
  {
    name: "reused-regex-legacy-quiet-not-removal-credit",
    code: "const expression = /^ */;\nexport const Example = (input: string) => { const width = expression.exec(input)![0].length; return <span>{width}</span>; };\n",
    count: 0,
  },
  {
    name: "custom-exec-legacy-quiet-not-removal-credit",
    code: "const provider = { exec(value: string) { return null; } };\nexport const Example = (input: string) => { const width = provider.exec(input)![0].length; return <span>{width}</span>; };\n",
    count: 0,
  },
  {
    name: "direct-custom-match-keeps-warning",
    code: "export const Example = (input: string) => { const width = ({ match() { return null; } }).match(/:*$/)![0].length; return <span>{width}</span>; };\n",
    count: 1,
  },
  {
    name: "local-custom-match-keeps-warning",
    code: "const provider = { match() { return null; } };\nexport const Example = (input: string) => { const width = provider.match(/:*$/)![0].length; return <span>{width}</span>; };\n",
    count: 1,
  },
  {
    name: "optional-result-access-legacy-quiet",
    code: "export const Example = (input: string) => { const width = input.match(/:*$/)?.[0].length; return <span>{width}</span>; };\n",
    count: 0,
  },
  {
    name: "escaped-star-legacy-exception",
    code: "export const Example = (input: string) => { const width = input.match(/^\\s*/)![0].length; return <span>{width}</span>; };\n",
    count: 0,
  },
  {
    name: "escaped-dual-anchor-legacy-warning",
    code: "export const Example = (input: string) => { const width = input.match(/^\\s*$/)![0].length; return <span>{width}</span>; };\n",
    count: 1,
  },
  {
    name: "dynamic-regex-legacy-outside-caller",
    code: "const pattern = /^ */;\nexport const Example = (input: string) => { const width = input.match(pattern)![0].length; return <span>{width}</span>; };\n",
    count: 0,
  },
  {
    name: "constructor-regex-legacy-outside-caller",
    code: 'export const Example = (input: string) => { const width = new RegExp("^ *").exec(input)![0].length; return <span>{width}</span>; };\n',
    count: 0,
  },
  {
    name: "optional-capture-does-not-become-wholematch",
    code: "export const Example = (input: string) => { const width = /(a)*$/.exec(input)![1].length; return <span>{width}</span>; };\n",
    count: 1,
  },
  {
    name: "unanchored-ordinary-literal-deliberately-unsupported",
    code: "export const Example = (input: string) => { const width = /:*/.exec(input)![0].length; return <span>{width}</span>; };\n",
    count: 1,
  },
  {
    name: "nonascii-literal-deliberately-unsupported",
    code: "export const Example = (input: string) => { const width = /^\u00e9*/.exec(input)![0].length; return <span>{width}</span>; };\n",
    count: 1,
  },
  {
    name: "opaque-receiver-origin-keeps-warning",
    code: 'import createProvider from "example-provider";\nconst provider = createProvider();\nexport const Example = (input: string) => { const width = provider.match(/:*$/)![0].length; return <span>{width}</span>; };\n',
    count: 1,
  },
  {
    name: "readonly-custom-object-alias-keeps-warning",
    code: "const provider = { match() { return null; } };\nconst alias = provider;\nexport const Example = (input: string) => { const width = alias.match(/:*$/)![0].length; return <span>{width}</span>; };\n",
    count: 1,
  },
  {
    name: "reassigned-parameter-custom-match",
    code: "export const Example = (input) => { input = { match() { return null; } }; return <span>{input.match(/:*$/)![0].length}</span>; };\n",
    count: 1,
  },
  {
    name: "array-pattern-parameter-write",
    code: "export const Example = (input, replacement) => { [input] = [replacement]; return <span>{input.match(/:*$/)![0].length}</span>; };\n",
    count: 1,
  },
  {
    name: "object-pattern-parameter-write",
    code: "export const Example = (input, replacement) => { ({ value: input } = replacement); return <span>{input.match(/:*$/)![0].length}</span>; };\n",
    count: 1,
  },
  {
    name: "loop-pattern-parameter-write",
    code: "export const Example = (input, values) => { for ([input] of values) {} return <span>{input.match(/:*$/)![0].length}</span>; };\n",
    count: 1,
  },
  {
    name: "local-parameter-alias-is-unsupported",
    code: "export const Example = (input: string) => { const alias = input; return <span>{alias.match(/:*$/)![0].length}</span>; };\n",
    count: 1,
  },
  {
    name: "direct-const-string-literal",
    code: 'export const Example = () => { const input = "section"; return <span>{input.match(/:*$/)![0].length}</span>; };\n',
    count: 0,
  },
  {
    name: "destructured-typed-string-parameter",
    code: "interface Input { text: string; }\nexport const Example = ({ text }: Input) => <span>{text.match(/:*$/)![0].length}</span>;\n",
    count: 0,
  },
  {
    name: "getter-member-receiver-is-unsupported",
    code: "const provider = { get text() { return { match() { return null; } }; } };\nexport const Example = () => <span>{provider.text.match(/:*$/)![0].length}</span>;\n",
    count: 1,
  },
  {
    name: "required-prefix-before-literal-star",
    code: "export const Example = (input: string) => <span>{/^x */.exec(input)![0].length}</span>;\n",
    count: 1,
  },
  {
    name: "lazy-literal-star-is-unsupported",
    code: "export const Example = (input: string) => <span>{input.match(/:*?$/)![0].length}</span>;\n",
    count: 1,
  },
  {
    name: "computed-method-new-fact-is-unsupported",
    code: 'export const Example = (input: string) => <span>{input["match"](/:*$/)![0].length}</span>;\n',
    count: 1,
  },
  {
    name: "global-exec-new-fact-is-unsupported",
    code: "export const Example = (input: string) => <span>{/^ */g.exec(input)![0].length}</span>;\n",
    count: 1,
  },
  {
    name: "unresolved-eval-read-abstains",
    code: "export const Example = (input: string) => { void eval; return <span>{input.match(/:*$/)![0].length}</span>; };\n",
    count: 1,
  },
  {
    name: "runtime-enum-parameter-write-abstains",
    code: "export const Example = (input) => { enum Change { Value = (input = { match() { return null; } }, 0) } return <span>{input.match(/:*$/)![0].length}</span>; };\n",
    count: 1,
  },
  {
    name: "case-insensitive-literal-star",
    code: "export const Example = (input: string) => <span>{input.match(/a*$/i)![0].length}</span>;\n",
    count: 0,
  },
  {
    name: "constructed-string-receiver-is-unsupported",
    code: 'export const Example = () => { const input = new String("section"); return <span>{input.match(/:*$/)![0].length}</span>; };\n',
    count: 1,
  },
  {
    name: "explicit-object-parameter-is-not-string",
    code: "export const Example = (input: { match(pattern: RegExp): null }) => <span>{input.match(/:*$/)![0].length}</span>;\n",
    count: 1,
  },
  {
    name: "explicit-function-parameter-is-not-string",
    code: "export const Example = (input: (() => string) & { match(pattern: RegExp): null }) => <span>{input.match(/:*$/)![0].length}</span>;\n",
    count: 1,
  },
  {
    name: "regexp-prototype-read-abstains",
    code: "export const Example = (input: string) => { void RegExp.prototype; return <span>{/^ */.exec(input)![0].length}</span>; };\n",
    count: 1,
  },
  {
    name: "string-prototype-read-abstains",
    code: "export const Example = (input: string) => { void String.prototype; return <span>{input.match(/:*$/)![0].length}</span>; };\n",
    count: 1,
  },
  {
    name: "global-namespace-provider-projection-abstains",
    code: "export const Example = (input: string) => { void globalThis.RegExp; return <span>{/^ */.exec(input)![0].length}</span>; };\n",
    count: 1,
  },
  {
    name: "constructor-value-alias-abstains",
    code: "const Constructor = RegExp;\nexport const Example = (input: string) => <span>{/^ */.exec(input)![0].length}</span>;\n",
    count: 1,
  },
  {
    name: "inline-structural-custom-match-parameter",
    code: "export const Example = ({ text }: { text: { match(pattern: RegExp): null } }) => <span>{text.match(/:*$/)![0].length}</span>;\n",
    count: 1,
  },
  {
    name: "renamed-inline-custom-match-parameter",
    code: "export const Example = ({ value: text }: { value: { match(pattern: RegExp): null } }) => <span>{text.match(/:*$/)![0].length}</span>;\n",
    count: 1,
  },
  {
    name: "inline-structural-string-parameter",
    code: "export const Example = ({ text }: { text: string }) => <span>{text.match(/:*$/)![0].length}</span>;\n",
    count: 0,
  },
  {
    name: "renamed-inline-string-parameter",
    code: "export const Example = ({ value: text }: { value: string }) => <span>{text.match(/:*$/)![0].length}</span>;\n",
    count: 0,
  },
  {
    name: "ordinary-direct-string-conversion-is-allowed",
    code: "export const Example = (input: string) => { const label = String(1); return <span title={label}>{input.match(/:*$/)![0].length}</span>; };\n",
    count: 0,
  },
  {
    name: "erased-regexp-type-does-not-expose-provider",
    code: "interface Options { expression: RegExp; }\nexport const Example = (input: string) => <span>{input.match(/:*$/)![0].length}</span>;\n",
    count: 0,
  },
  {
    name: "annotated-array-pattern-custom-match-abstains",
    code: "export const Example = ([input]: [{ match(pattern: RegExp): null }]) => <span>{input.match(/:*$/)![0].length}</span>;\n",
    count: 1,
  },
  {
    name: "global-self-projection-carrier-abstains",
    code: "export const Example = (input: string) => { void window.window.RegExp.prototype; return <span>{/^ */.exec(input)![0].length}</span>; };\n",
    count: 1,
  },
  {
    name: "program-eval-read-defers-native-exec",
    code: "void eval;\nexport const Example = (input: string) => <span>{/^ */.exec(input)![0].length}</span>;\n",
    count: 1,
  },
  {
    name: "ordinary-constructor-field-does-not-change-native-regex-provider",
    code: "class Holder { constructor(public label: string) {} }\nexport const Example = (input: string) => <span>{input.match(/:*$/)![0].length}</span>;\n",
    count: 0,
  },
  {
    name: "constructor-field-default-remains-unsupported",
    code: 'class Holder { constructor(public label: string = "") {} }\nexport const Example = (input: string) => <span>{input.match(/:*$/)![0].length}</span>;\n',
    count: 1,
  },
  {
    name: "constructor-field-native-projection-default-remains-unsupported",
    code: "class Holder { constructor(public native = RegExp.prototype) {} }\nexport const Example = (input: string) => <span>{input.match(/:*$/)![0].length}</span>;\n",
    count: 1,
  },
  {
    name: "decorated-constructor-field-remains-unsupported",
    code: "const decorateParameter = () => {};\nclass Holder { constructor(@decorateParameter public label: string) {} }\nexport const Example = (input: string) => <span>{input.match(/:*$/)![0].length}</span>;\n",
    count: 1,
  },
];

describe("literal-star whole regex match", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(
        noArrayIndexDerefWithoutBoundsOrEmptyGuard,
        testCase.code,
        commonOptions,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.count);
    });
  }
});
