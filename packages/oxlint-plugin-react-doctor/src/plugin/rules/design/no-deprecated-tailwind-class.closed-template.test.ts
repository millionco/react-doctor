import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDeprecatedTailwindClass } from "./no-deprecated-tailwind-class.js";

interface ClosedTemplateCase {
  name: string;
  code: string;
  expected: number;
  capabilities?: string[];
}

const cases: ClosedTemplateCase[] = [
  {
    name: "closed literal suffix",
    code: 'export const Panel=({active})=><span className={`inline-flex flex-shrink-0 ${active ? "rotate-180" : ""}`} />;',
    expected: 1,
  },
  {
    name: "literal positive",
    code: 'export const Panel=()=> <span className="flex-shrink-0" />;',
    expected: 1,
  },
  {
    name: "unknown token interpolation",
    code: "export const Panel=({size})=><span className={`flex-shrink-${size}`} />;",
    expected: 0,
  },
  {
    name: "later opaque spread",
    code: 'export const Panel=({active,forwarded})=><span className={`flex-shrink-0 ${active ? "rotate-180" : ""}`} {...forwarded} />;',
    expected: 0,
  },
  {
    name: "branch-only deprecated suffix",
    code: 'export const Panel=({active})=><span className={`inline-flex ${active ? "flex-shrink-0" : ""}`} />;',
    expected: 0,
  },
  {
    name: "joined prefix token",
    code: 'export const Panel=({active})=><span className={`flex-shrink-0${active ? "suffix" : ""}`} />;',
    expected: 0,
  },
  {
    name: "whitespace inside arbitrary value",
    code: 'export const Panel=({active})=><span className={`flex-shrink-[calc(1 + ${active ? "2px" : "3px"})]`} />;',
    expected: 0,
  },
  {
    name: "unknown suffix expression",
    code: "export const Panel=({suffix})=><span className={`flex-shrink-0 ${suffix}`} />;",
    expected: 0,
  },
  {
    name: "nested conditional branch",
    code: 'export const Panel=({active,alternate})=><span className={`flex-shrink-0 ${active ? (alternate ? "rotate-90" : "") : ""}`} />;',
    expected: 0,
  },
  {
    name: "identifier branch",
    code: 'export const Panel=({active,suffix})=><span className={`flex-shrink-0 ${active ? suffix : ""}`} />;',
    expected: 0,
  },
  {
    name: "opaque class merger",
    code: 'export const Panel=({active})=><span className={cn(`flex-shrink-0 ${active ? "rotate-180" : ""}`)} />;',
    expected: 0,
  },
  {
    name: "tagged template",
    code: 'export const Panel=({active})=><span className={classes`flex-shrink-0 ${active ? "rotate-180" : ""}`} />;',
    expected: 0,
  },
  {
    name: "conditional attribute outside template",
    code: 'export const Panel=({active})=><span className={active ? "flex-shrink-0" : ""} />;',
    expected: 0,
  },
  {
    name: "multiple interpolations",
    code: 'export const Panel=({active,compact})=><span className={`flex-shrink-0 ${active ? "rotate-180" : ""} ${compact ? "p-1" : ""}`} />;',
    expected: 0,
  },
  {
    name: "variant prefix",
    code: 'export const Panel=({active})=><span className={`md:flex-shrink-0 ${active ? "rotate-180" : ""}`} />;',
    expected: 1,
  },
  {
    name: "multiple deprecated prefix tokens",
    code: 'export const Panel=({active})=><span className={`flex-shrink-0 flex-grow ${active ? "rotate-180" : ""}`} />;',
    expected: 2,
  },
  {
    name: "canonical prefix with deprecated suffix only",
    code: 'export const Panel=({active})=><span className={`shrink-0 ${active ? "flex-grow" : ""}`} />;',
    expected: 0,
  },
  {
    name: "cooked newline boundary",
    code: 'export const Panel=({active})=><span className={`flex-shrink-0\\n${active ? "rotate-180" : ""}`} />;',
    expected: 1,
  },
  {
    name: "transparent parentheses",
    code: 'export const Panel=({active})=><span className={(`flex-shrink-0 ${(active ? "rotate-180" : "")}`)} />;',
    expected: 1,
  },
  {
    name: "later explicit canonical attribute",
    code: 'export const Panel=({active})=><span className={`flex-shrink-0 ${active ? "rotate-180" : ""}`} className="shrink-0" />;',
    expected: 0,
  },
  {
    name: "earlier opaque spread",
    code: 'export const Panel=({active,forwarded})=><span {...forwarded} className={`flex-shrink-0 ${active ? "rotate-180" : ""}`} />;',
    expected: 1,
  },
  {
    name: "later harmless static spread",
    code: 'export const Panel=({active})=><span className={`flex-shrink-0 ${active ? "rotate-180" : ""}`} {...{title:"label"}} />;',
    expected: 1,
  },
  {
    name: "non-tailwind4 capability",
    code: 'export const Panel=({active})=><span className={`flex-shrink-0 ${active ? "rotate-180" : ""}`} />;',
    expected: 0,
    capabilities: ["react"],
  },
  {
    name: "static template legacy path",
    code: "export const Panel=()=> <span className={`flex-shrink-0`} />;",
    expected: 1,
  },
  {
    name: "non-string conditional branch",
    code: 'export const Panel=({active})=><span className={`flex-shrink-0 ${active ? 2 : ""}`} />;',
    expected: 0,
  },
  {
    name: "empty prefix",
    code: 'export const Panel=({active})=><span className={`${active ? "flex-shrink-0" : ""}`} />;',
    expected: 0,
  },
  {
    name: "important variant prefix",
    code: 'export const Panel=({active})=><span className={`group-hover:!flex-shrink-0 ${active ? "rotate-180" : ""}`} />;',
    expected: 1,
  },
  {
    name: "later static class override",
    code: 'export const Panel=({active})=><span className={`flex-shrink-0 ${active ? "rotate-180" : ""}`} {...{className:"shrink-0"}} />;',
    expected: 0,
  },
  {
    name: "nonbreaking-space boundary",
    code: 'export const Panel=({active})=><span className={`flex-shrink-0\\u00a0${active ? "rotate-180" : ""}`} />;',
    expected: 0,
  },
  {
    name: "vertical-tab boundary",
    code: 'export const Panel=({active})=><span className={`flex-shrink-0\\u000b${active ? "rotate-180" : ""}`} />;',
    expected: 0,
  },
  {
    name: "nonbreaking-space leading token",
    code: 'export const Panel=({active})=><span className={`\\u00a0flex-shrink-0 ${active ? "rotate-180" : ""}`} />;',
    expected: 0,
  },
  {
    name: "vertical-tab leading token",
    code: 'export const Panel=({active})=><span className={`\\u000bflex-shrink-0 ${active ? "rotate-180" : ""}`} />;',
    expected: 0,
  },
];

describe("no-deprecated-tailwind-class closed template prefix", () => {
  it.each(cases)("$name", ({ code, expected, capabilities }) => {
    const result = runRule(noDeprecatedTailwindClass, code, {
      filename: "src/panel.tsx",
      settings: { "react-doctor": { capabilities: capabilities ?? ["react", "tailwind:4"] } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
