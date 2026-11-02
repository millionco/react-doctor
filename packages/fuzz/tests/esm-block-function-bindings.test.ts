import { describe, expect, it } from "vite-plus/test";
import { effectNeedsCleanup } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/effect-needs-cleanup.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { buildVerdictPreservingVariants } from "../src/verdict-preserving-variants.js";

interface LexicalTimerCase {
  name: string;
  source: string;
  warnings: number;
}

const cases: ReadonlyArray<LexicalTimerCase> = [
  {
    name: "native interval outside a lexical shadow",
    source: `import {useEffect} from 'react';
      if(false){function setInterval(){}}
      const Panel=()=>{useEffect(()=>{setInterval(refresh,100);},[]);return null;};`,
    warnings: 1,
  },
  {
    name: "native timeout outside a lexical shadow",
    source: `import {useEffect} from 'react';
      if(false){function setTimeout(){}}
      const Panel=()=>{useEffect(()=>{setTimeout(refresh,100);},[]);return null;};`,
    warnings: 1,
  },
  {
    name: "actual lexical shadow inside its block",
    source: `import {useEffect} from 'react';
      {function setInterval(){}
        const Panel=()=>{useEffect(()=>{setInterval(refresh,100);},[]);return null;};}`,
    warnings: 0,
  },
];

describe("ESM block function verdicts", () => {
  it.each(cases)("preserves $name through default rewrites", (testCase) => {
    const filename = "fixture.tsx";
    const original = runRule(effectNeedsCleanup, testCase.source, { filename });
    expect(original.parseErrors).toEqual([]);
    expect(original.diagnostics).toHaveLength(testCase.warnings);
    const variants = buildVerdictPreservingVariants(testCase.source, filename).filter(
      (variant) => variant.mustPreserveVerdict,
    );
    expect(variants.length).toBeGreaterThan(0);
    for (const variant of variants) {
      const result = runRule(effectNeedsCleanup, variant.code, { filename });
      expect(result.parseErrors, variant.label).toEqual([]);
      expect(result.diagnostics, variant.label).toHaveLength(testCase.warnings);
    }
  });
});
