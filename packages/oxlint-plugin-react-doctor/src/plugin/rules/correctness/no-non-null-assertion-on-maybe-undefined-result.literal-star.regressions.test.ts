import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNonNullAssertionOnMaybeUndefinedResult } from "./no-non-null-assertion-on-maybe-undefined-result.js";

const commonOptions = { forceJsx: true, includeLocations: true };

const cases = [
  {
    name: "ambient-regex-provider-mutation-retains-warning",
    code: "declare const RegExp: any; RegExp.prototype.exec = () => null; export const read = (input: string) => input.match(/^a*/)![0].length;",
    filename: "src/ambient-regex-provider.tsx",
    count: 1,
  },
  {
    name: "reflected-string-prototype-mutation-retains-warning",
    code: 'Object.getPrototypeOf("").match = () => null; export const read = (input: string) => input.match(/^a*/)![0].length;',
    filename: "src/reflected-string-provider.tsx",
    count: 1,
  },
  {
    name: "literal-constructor-prototype-mutation-retains-warning",
    code: "(/x/).constructor.prototype.exec = () => null; export const read = (input: string) => input.match(/^a*/)![0].length;",
    filename: "src/reflected-regex-provider.tsx",
    count: 1,
  },
  {
    name: "erased-regex-type-import-retains-runtime-provider-warning",
    code: 'import type { RegExp } from "matcher-types"; RegExp.prototype.exec = () => null; export const read = (input: string) => input.match(/^a*/)![0].length;',
    filename: "src/erased-regex-provider.tsx",
    count: 1,
  },
  {
    name: "native-terminal-colon",
    code: "export const View = ({ text }: { text: string }) => <span>{text.match(/:*$/)![0].length}</span>;\n",
    filename: "/public/src/components/non-null-literal-star-0.tsx",
    count: 0,
  },
  {
    name: "native-leading-space",
    code: "export const View = ({ text }: { text: string }) => <span>{text.match(/^ */)![0].length}</span>;\n",
    filename: "/public/src/components/non-null-literal-star-1.tsx",
    count: 0,
  },
  {
    name: "direct-string-literal",
    code: 'export const View = () => <span>{"plain".match(/:*$/)!.length}</span>;\n',
    filename: "/public/src/components/non-null-literal-star-2.tsx",
    count: 0,
  },
  {
    name: "readonly-local-string",
    code: 'export const View = () => { const text = "plain"; return <span>{text.match(/:*$/)![0].length}</span>; };\n',
    filename: "/public/src/components/non-null-literal-star-3.tsx",
    count: 0,
  },
  {
    name: "renamed-inline-string-property",
    code: "export const View = ({ text: value }: { text: string }) => <span>{value.match(/:*$/)![0].length}</span>;\n",
    filename: "/public/src/components/non-null-literal-star-4.tsx",
    count: 0,
  },
  {
    name: "custom-receiver-retained",
    code: "const matcher = { match() { return null; } }; export const View = () => <span>{matcher.match(/:*$/)![0].length}</span>;\n",
    filename: "/public/src/components/non-null-literal-star-5.tsx",
    count: 1,
  },
  {
    name: "opaque-call-origin-retained",
    code: "declare const acquire: () => { match(pattern: RegExp): string[] | null }; export const View = () => { const text = acquire(); return <span>{text.match(/:*$/)![0].length}</span>; };\n",
    filename: "/public/src/components/non-null-literal-star-6.tsx",
    count: 1,
  },
  {
    name: "mutated-parameter-retained",
    code: 'export const View = (text: string) => { text = "changed"; return <span>{text.match(/:*$/)![0].length}</span>; };\n',
    filename: "/public/src/components/non-null-literal-star-7.tsx",
    count: 1,
  },
  {
    name: "required-suffix-retained",
    code: "export const View = ({ text }: { text: string }) => <span>{text.match(/a*Z$/)![0].length}</span>;\n",
    filename: "/public/src/components/non-null-literal-star-8.tsx",
    count: 1,
  },
  {
    name: "dual-anchor-retained",
    code: "export const View = ({ text }: { text: string }) => <span>{text.match(/^a*$/)![0].length}</span>;\n",
    filename: "/public/src/components/non-null-literal-star-9.tsx",
    count: 1,
  },
  {
    name: "stateful-global-retained",
    code: "export const View = ({ text }: { text: string }) => <span>{text.match(/:*$/g)![0].length}</span>;\n",
    filename: "/public/src/components/non-null-literal-star-10.tsx",
    count: 1,
  },
  {
    name: "capture-index-separate-rule-boundary",
    code: "export const View = ({ text }: { text: string }) => <span>{text.match(/:*$/)![1].length}</span>;\n",
    filename: "/public/src/components/non-null-literal-star-11.tsx",
    count: 0,
  },
  {
    name: "provider-prototype-read-abstention",
    code: "void RegExp.prototype; export const View = ({ text }: { text: string }) => <span>{text.match(/:*$/)![0].length}</span>;\n",
    filename: "/public/src/components/non-null-literal-star-12.tsx",
    count: 1,
  },
  {
    name: "eval-symbol-read-abstention",
    code: "void eval; export const View = ({ text }: { text: string }) => <span>{text.match(/:*$/)![0].length}</span>;\n",
    filename: "/public/src/components/non-null-literal-star-13.tsx",
    count: 1,
  },
  {
    name: "inert-constructor-field-allowed",
    code: "class Point { constructor(public label: string) {} } export const View = ({ text }: { text: string }) => <span>{text.match(/:*$/)![0].length}</span>;\n",
    filename: "/public/src/components/non-null-literal-star-14.tsx",
    count: 0,
  },
  {
    name: "constructor-default-retains-abstention",
    code: 'class Point { constructor(public label: string = "plain") {} } export const View = ({ text }: { text: string }) => <span>{text.match(/:*$/)![0].length}</span>;\n',
    filename: "/public/src/components/non-null-literal-star-15.tsx",
    count: 1,
  },
  {
    name: "legacy-shared-dot-star-quiet",
    code: "export const View = ({ text }: { text: string }) => <span>{text.match(/.*/)![0].length}</span>;\n",
    filename: "/public/src/components/non-null-literal-star-16.tsx",
    count: 0,
  },
];

describe("no-non-null-assertion-on-maybe-undefined-result literal-star regressions", () => {
  it.each(cases)("$name", ({ code, filename, count }) => {
    const result = runRule(noNonNullAssertionOnMaybeUndefinedResult, code, {
      filename,
      ...commonOptions,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(count);
  });
});
